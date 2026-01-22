// ============================================================================
// EBAY API BACKEND SERVER - PRODUCTION
// ============================================================================

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const qs = require('querystring');

const app = express();
const PORT = 3001;

// ============================================================================
// EBAY PRODUCTION CREDENTIALS
// ============================================================================
const EBAY_CONFIG = {
  APP_ID: process.env.EBAY_APP_ID,
  DEV_ID: process.env.EBAY_DEV_ID,
  CERT_ID: process.env.EBAY_CERT_ID,

 // Claude API for image analysis
  CLAUDE_API_KEY: process.env.CLAUDE_API_KEY,
  // PRODUCTION API Endpoints
  FINDING_API: 'https://svcs.ebay.com/services/search/FindingService/v1',
  BROWSE_API: 'https://api.ebay.com/buy/browse/v1',
  OAUTH_API: 'https://api.ebay.com/identity/v1/oauth2/token'
};

// ============================================================================
// MIDDLEWARE SETUP
// ============================================================================
app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// ============================================================================
// OAUTH TOKEN MANAGEMENT
// ============================================================================
let cachedToken = null;
let tokenExpiry = null;

async function getOAuthToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
    console.log('Using cached OAuth token');
    return cachedToken;
  }

  console.log('Fetching new OAuth token from eBay...');

  try {
    const credentials = Buffer.from(
      `${EBAY_CONFIG.APP_ID}:${EBAY_CONFIG.CERT_ID}`
    ).toString('base64');

    const response = await axios.post(
      EBAY_CONFIG.OAUTH_API,
      qs.stringify({
        grant_type: 'client_credentials',
        scope: 'https://api.ebay.com/oauth/api_scope'
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${credentials}`
        }
      }
    );

    cachedToken = response.data.access_token;
    tokenExpiry = Date.now() + ((response.data.expires_in - 300) * 1000);

    console.log('Successfully obtained new OAuth token');
    return cachedToken;

  } catch (error) {
    console.error('Error getting OAuth token:', error.response?.data || error.message);
    throw new Error('Failed to get eBay OAuth token');
  }
}
// ============================================================================
// IMAGE ANALYSIS ENDPOINT
// ============================================================================
app.post('/api/analyze-image', async (req, res) => {
  try {
    const { imageData, mimeType } = req.body;

    if (!imageData) {
      return res.status(400).json({ error: 'Image data is required' });
    }

    console.log('Analyzing image with Claude...');

    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType,
                data: imageData
              }
            },
            {
              type: 'text',
              text: 'Analyze this image and provide a concise eBay search query (3-8 words) that would find similar items. Include: brand (if visible), item type, model/version, and key features. Return ONLY the search query, nothing else.'
            }
          ]
        }]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': EBAY_CONFIG.CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01'
        }
      }
    );

    const description = response.data.content[0].text.trim();
    console.log(`Image identified as: "${description}"`);

    res.json({ description });

  } catch (error) {
    console.error('Error analyzing image:', error.message);
    res.status(500).json({ 
      error: 'Failed to analyze image',
      details: error.message 
    });
  }
});
// ============================================================================
// API ENDPOINT 1: SEARCH CURRENT LISTINGS (SOLD DATA REMOVED)
// ============================================================================
// ============================================================================
// API ENDPOINT 2: SEARCH CURRENT LISTINGS
// ============================================================================
app.post('/api/ebay/current', async (req, res) => {
  try {
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    console.log(`Searching current listings for: "${query}"`);

    const token = await getOAuthToken();

    const response = await axios.get(
      `${EBAY_CONFIG.BROWSE_API}/item_summary/search`,
      {
        params: {
          q: query,
          limit: 50
        },
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
          'X-EBAY-C-ENDUSERCTX': 'affiliateCampaignId=<ePNCampaignId>,affiliateReferenceId=<referenceId>'
        }
      }
    );

    const items = response.data.itemSummaries || [];

    const currentListings = items.map(item => ({
      title: item.title || 'No title',
      price: parseFloat(item.price?.value || 0),
      condition: item.condition || 'Not specified',
      itemUrl: item.itemWebUrl || '',
      imageUrl: item.image?.imageUrl || '',
      seller: item.seller?.username || 'Unknown',
      shippingCost: parseFloat(item.shippingOptions?.[0]?.shippingCost?.value || 0),
      location: item.itemLocation?.city || ''
    }));

    console.log(`Found ${currentListings.length} current listings`);

    res.json({
      items: currentListings,
      count: currentListings.length
    });

  } catch (error) {
    console.error('Error in /api/ebay/current:', error.message);
    console.error('eBay Error Details:', error.response?.data);
    res.status(500).json({ 
      error: 'Failed to search current listings',
      details: error.message,
      ebayError: error.response?.data
    });
  }
});

// ============================================================================
// HEALTH CHECK ENDPOINT
// ============================================================================
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'eBay API Backend Server is running - PRODUCTION MODE',
    timestamp: new Date().toISOString()
  });
});

// ============================================================================
// START THE SERVER
// ============================================================================
app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('eBay API Backend Server Started - PRODUCTION MODE');
  console.log('='.repeat(60));
  console.log(`Server running on: http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log('');
  console.log('Available endpoints:');
  console.log(`  POST http://localhost:${PORT}/api/ebay/sold`);
  console.log(`  POST http://localhost:${PORT}/api/ebay/current`);
  console.log('='.repeat(60));
});

// ============================================================================
// ERROR HANDLING
// ============================================================================
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});
