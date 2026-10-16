/**
 * YouTube Data API v3 via UrlFetchApp + Brand OAuth token.
 * Used when Method 3 auth is connected (scheduled/private for Brand Accounts).
 */

/**
 * @param {string} resource e.g. 'channels', 'playlistItems', 'videos'
 * @param {Object<string,string>} params query params
 * @return {Object} parsed JSON
 */
function youtubeHttpGet_(resource, params) {
  var accessToken = getBrandAccessToken_();

  var qs = [];
  var keys = Object.keys(params);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (params[k] === undefined || params[k] === null || params[k] === '') {
      continue;
    }
    qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(params[k])));
  }

  var url =
    'https://www.googleapis.com/youtube/v3/' + resource + '?' + qs.join('&');

  var resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + accessToken
    },
    muteHttpExceptions: true
  });

  var code = resp.getResponseCode();
  var body = resp.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error(
      'YouTube API HTTP ' + code + ' on ' + resource + ':\n' + body
    );
  }
  return JSON.parse(body);
}

/**
 * Resolve channel + uploads playlist using Brand OAuth token.
 * @param {Object} cfg
 * @return {{channelId: string, uploadsPlaylistId: string, title: string, authPath: string}}
 */
function resolveChannelBrandHttp_(cfg) {
  var wantId = String(cfg.channelId || '').trim();
  var wantHandle = normalizeHandle_(cfg.channelHandle || '');

  // Prefer mine=true under brand token (should list Playbook if brand was picked).
  var mine = youtubeHttpGet_('channels', {
    part: 'snippet,contentDetails',
    mine: 'true',
    maxResults: '50'
  });
  var mineItems = mine.items || [];
  for (var i = 0; i < mineItems.length; i++) {
    var ch = mineItems[i];
    var customUrl = normalizeHandle_((ch.snippet && ch.snippet.customUrl) || '');
    var title = ((ch.snippet && ch.snippet.title) || '').toLowerCase();
    var idMatch = wantId && ch.id === wantId;
    var handleMatch =
      wantHandle &&
      (customUrl === wantHandle || title.indexOf(wantHandle) !== -1);
    if (idMatch || handleMatch || (!wantId && !wantHandle && mineItems.length === 1)) {
      return channelResult_(ch, 'brand-refresh-token (mine)');
    }
  }

  // Fall back: fetch brand channel by id/handle with the same token.
  var params = { part: 'snippet,contentDetails' };
  if (wantId) {
    params.id = wantId;
  } else if (wantHandle) {
    params.forHandle = wantHandle;
  } else {
    throw new Error('Set channel_id or channel_handle in _config.');
  }

  var pub = youtubeHttpGet_('channels', params);
  if (!pub.items || !pub.items.length) {
    throw new Error('Brand OAuth: channel not found for id/handle.');
  }
  return channelResult_(
    pub.items[0],
    'brand-refresh-token (by id/handle; re-run get_brand_refresh_token.py if scheduled missing)'
  );
}

/**
 * @param {string} uploadsPlaylistId
 * @return {string[]}
 */
function listUploadVideoIdsHttp_(uploadsPlaylistId) {
  var ids = [];
  var pageToken = '';
  do {
    var params = {
      part: 'contentDetails',
      playlistId: uploadsPlaylistId,
      maxResults: '50'
    };
    if (pageToken) {
      params.pageToken = pageToken;
    }
    var page = youtubeHttpGet_('playlistItems', params);
    var items = page.items || [];
    for (var i = 0; i < items.length; i++) {
      var vid =
        items[i].contentDetails && items[i].contentDetails.videoId;
      if (vid) {
        ids.push(vid);
      }
    }
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return ids;
}

/**
 * @param {string[]} videoIds
 * @return {Array[]}
 */
function fetchVideoDetailsHttp_(videoIds) {
  var syncedAt = new Date();
  var rows = [];
  for (var i = 0; i < videoIds.length; i += 50) {
    var batch = videoIds.slice(i, i + 50);
    var resp = youtubeHttpGet_('videos', {
      part: 'snippet,status,contentDetails,statistics',
      id: batch.join(',')
    });
    var items = resp.items || [];
    for (var j = 0; j < items.length; j++) {
      rows.push(normalizeVideo_(items[j], syncedAt));
    }
  }
  return rows;
}
