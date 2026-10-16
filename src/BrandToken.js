/**
 * Brand YouTube access via a refresh token obtained outside Apps Script
 * (scripts/get_brand_refresh_token.py). Avoids the broken /usercallback
 * path when authorizing as a Brand Account.
 *
 * Script properties:
 *   YOUTUBE_OAUTH_CLIENT_ID
 *   YOUTUBE_OAUTH_CLIENT_SECRET
 *   YOUTUBE_BRAND_REFRESH_TOKEN
 */

var BRAND_TOKEN_CACHE_KEY = 'brand_yt_access_token';

/**
 * Prefer refresh-token auth; fall back to OAuth2 library service.
 * @return {boolean}
 */
function hasBrandYouTubeAuth_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('YOUTUBE_BRAND_REFRESH_TOKEN')) {
    return true;
  }
  try {
    return getBrandYouTubeService_().hasAccess();
  } catch (e) {
    return false;
  }
}

/**
 * @return {string} Bearer access token
 */
function getBrandAccessToken_() {
  var props = PropertiesService.getScriptProperties();
  var refresh = props.getProperty('YOUTUBE_BRAND_REFRESH_TOKEN');

  if (refresh) {
    var cache = CacheService.getScriptCache();
    var cached = cache.get(BRAND_TOKEN_CACHE_KEY);
    if (cached) {
      return cached;
    }

    var clientId = props.getProperty('YOUTUBE_OAUTH_CLIENT_ID');
    var clientSecret = props.getProperty('YOUTUBE_OAUTH_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      throw new Error(
        'YOUTUBE_BRAND_REFRESH_TOKEN is set but client id/secret are missing.'
      );
    }

    var resp = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
      method: 'post',
      payload: {
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refresh,
        grant_type: 'refresh_token'
      },
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    var body = JSON.parse(resp.getContentText());
    if (code < 200 || code >= 300 || !body.access_token) {
      throw new Error(
        'Failed to refresh Brand YouTube token (HTTP ' +
          code +
          '):\n' +
          resp.getContentText() +
          '\n\nRe-run scripts/get_brand_refresh_token.py and update ' +
          'YOUTUBE_BRAND_REFRESH_TOKEN.'
      );
    }

    var ttl = Math.max(60, Number(body.expires_in || 3600) - 120);
    cache.put(BRAND_TOKEN_CACHE_KEY, body.access_token, ttl);
    return body.access_token;
  }

  var service = getBrandYouTubeService_();
  if (!service.hasAccess()) {
    throw new Error(
      'Brand YouTube is not authorized.\n' +
        'Preferred: run scripts/get_brand_refresh_token.py and set ' +
        'YOUTUBE_BRAND_REFRESH_TOKEN in Script properties.\n' +
        'See docs/BRAND_OAUTH_SETUP.md'
    );
  }
  return service.getAccessToken();
}

/**
 * Menu: confirm refresh-token auth and list mine=true channels.
 */
function listBrandYouTubeChannels() {
  if (!hasBrandYouTubeAuth_()) {
    uiAlert_(
      'Brand YouTube is not configured yet.\n\n' +
        '1. python3 scripts/get_brand_refresh_token.py\n' +
        '2. Paste refresh token into Script property YOUTUBE_BRAND_REFRESH_TOKEN\n' +
        '3. Ensure CLIENT_ID / CLIENT_SECRET match the Desktop OAuth client\n\n' +
        'See docs/BRAND_OAUTH_SETUP.md'
    );
    return;
  }
  uiAlert_(summarizeBrandTokenChannels_());
}
