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
  // PRODUCTION API Endpoints
  FINDING_API: 'https://svcs.ebay.com/services/search/FindingService/v1',
  BROWSE_API: 'https://api.ebay.com/buy/browse/v1',
  OAUTH_API: 'https://api.ebay.com/identity/v1/oauth2/token'
};

// ============================================================================
// MIDDLEWARE SETUP
// ============================================================================
app.use(cors());
app.use(express.json());

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
// API ENDPOINT 1: SEARCH SOLD ITEMS
// ============================================================================
app.post('/api/ebay/sold', async (req, res) => {
  try {
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    console.log(`Searching sold items for: "${query}"`);

    const params = {
      'OPERATION-NAME': 'findCompletedItems',
      'SERVICE-VERSION': '1.0.0',
      'SECURITY-APPNAME': EBAY_CONFIG.APP_ID,
      'RESPONSE-DATA-FORMAT': 'JSON',
      'REST-PAYLOAD': '',
      'keywords': query,
      'paginationInput.entriesPerPage': '100',
      'paginationInput.pageNumber': '1',
      'itemFilter(0).name': 'SoldItemsOnly',
      'itemFilter(0).value': 'true',
      'sortOrder': 'EndTimeSoonest'
    };

    const response = await axios.get(EBAY_CONFIG.FINDING_API, { params });

    const searchResult = response.data.findCompletedItemsResponse?.[0]?.searchResult?.[0];
    
    if (!searchResult || searchResult['@count'] === '0') {
      console.log('No sold items found');
      return res.json({ items: [], count: 0 });
    }

    const items = searchResult.item || [];

    const soldItems = items.map(item => ({
      title: item.title?.[0] || 'No title',
      price: parseFloat(item.sellingStatus?.[0]?.currentPrice?.[0]?.__value__ || 0),
      soldDate: item.listingInfo?.[0]?.endTime?.[0] || null,
      condition: item.condition?.[0]?.conditionDisplayName?.[0] || 'Not specified',
      shipping: parseFloat(item.shippingInfo?.[0]?.shippingServiceCost?.[0]?.__value__ || 0),
      itemUrl: item.viewItemURL?.[0] || '',
      imageUrl: item.galleryURL?.[0] || '',
      location: item.location?.[0] || ''
    }));

    console.log(`Found ${soldItems.length} sold items`);

    res.json({
      items: soldItems,
      count: soldItems.length
    });

  } catch (error) {
    console.error('Error in /api/ebay/sold:', error.message);
    console.error('eBay Error Details:', error.response?.data);
    console.error('Status Code:', error.response?.status);
    res.status(500).json({ 
      error: 'Failed to search sold items',
      details: error.message,
      ebayError: error.response?.data
    });
  }
});

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