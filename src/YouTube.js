/**
 * YouTube Data API helpers (Apps Script Advanced Service: YouTube v3).
 * Runs as the signed-in user. Channel owners can see private / unlisted /
 * scheduled uploads; others typically only see public videos.
 */

/**
 * Resolve uploads playlist ID for a channel handle or channel ID.
 * @param {{channelHandle: string, channelId: string}} cfg
 * @return {{channelId: string, uploadsPlaylistId: string, title: string}}
 */
function resolveChannel_(cfg) {
  var response;

  if (cfg.channelId) {
    response = YouTube.Channels.list('snippet,contentDetails', {
      id: cfg.channelId
    });
  } else if (cfg.channelHandle) {
    // forHandle: no leading @
    response = YouTube.Channels.list('snippet,contentDetails', {
      forHandle: cfg.channelHandle
    });
  } else {
    throw new Error(
      'Set channel_handle or channel_id in the _config sheet.'
    );
  }

  if (!response.items || !response.items.length) {
    throw new Error(
      'Channel not found for handle="' +
        cfg.channelHandle +
        '" id="' +
        cfg.channelId +
        '".'
    );
  }

  var ch = response.items[0];
  var uploads =
    ch.contentDetails &&
    ch.contentDetails.relatedPlaylists &&
    ch.contentDetails.relatedPlaylists.uploads;

  if (!uploads) {
    throw new Error('Channel has no uploads playlist: ' + ch.id);
  }

  return {
    channelId: ch.id,
    uploadsPlaylistId: uploads,
    title: (ch.snippet && ch.snippet.title) || ch.id
  };
}

/**
 * List all video IDs from the channel uploads playlist.
 * @param {string} uploadsPlaylistId
 * @return {string[]}
 */
function listUploadVideoIds_(uploadsPlaylistId) {
  var ids = [];
  var pageToken = null;

  do {
    var opts = {
      playlistId: uploadsPlaylistId,
      maxResults: 50
    };
    if (pageToken) {
      opts.pageToken = pageToken;
    }

    var page = YouTube.PlaylistItems.list('contentDetails', opts);

    var items = page.items || [];
    for (var i = 0; i < items.length; i++) {
      var vid =
        items[i].contentDetails && items[i].contentDetails.videoId;
      if (vid) {
        ids.push(vid);
      }
    }
    pageToken = page.nextPageToken || null;
  } while (pageToken);

  return ids;
}

/**
 * Fetch video metadata in batches of 50.
 * @param {string[]} videoIds
 * @return {Object[]} normalized rows matching CONFIG.RAW_HEADERS
 */
function fetchVideoDetails_(videoIds) {
  var syncedAt = new Date();
  var rows = [];

  for (var i = 0; i < videoIds.length; i += 50) {
    var batch = videoIds.slice(i, i + 50);
    var resp = YouTube.Videos.list(
      'snippet,status,contentDetails,statistics',
      { id: batch.join(',') }
    );

    var items = resp.items || [];
    for (var j = 0; j < items.length; j++) {
      rows.push(normalizeVideo_(items[j], syncedAt));
    }
  }

  return rows;
}

/**
 * Map a YouTube Videos resource to a _youtube_raw row.
 * @param {Object} v
 * @param {Date} syncedAt
 * @return {Array}
 */
function normalizeVideo_(v, syncedAt) {
  var privacy = (v.status && v.status.privacyStatus) || '';
  var publishAt = (v.status && v.status.publishAt) || '';
  var publishedAt = (v.snippet && v.snippet.publishedAt) || '';
  var scheduled = !!publishAt && privacy !== 'public';

  var statusLabel = privacy || 'unknown';
  if (scheduled) {
    statusLabel = 'scheduled';
  } else if (privacy === 'public') {
    statusLabel = 'published';
  } else if (privacy === 'unlisted') {
    statusLabel = 'unlisted';
  } else if (privacy === 'private') {
    statusLabel = 'private';
  }

  var when = scheduled ? publishAt : publishedAt;
  var stats = v.statistics || {};
  var durationIso =
    (v.contentDetails && v.contentDetails.duration) || '';

  return [
    v.id,
    (v.snippet && v.snippet.title) || '',
    'https://www.youtube.com/watch?v=' + v.id,
    statusLabel,
    when ? new Date(when) : '',
    numOrBlank_(stats.viewCount),
    numOrBlank_(stats.likeCount),
    numOrBlank_(stats.commentCount),
    iso8601DurationToClock_(durationIso),
    privacy,
    syncedAt
  ];
}

function numOrBlank_(v) {
  if (v === undefined || v === null || v === '') return '';
  var n = Number(v);
  return isNaN(n) ? '' : n;
}

/**
 * Convert ISO-8601 duration (PT#H#M#S) to H:MM:SS or M:SS.
 * @param {string} iso
 * @return {string}
 */
function iso8601DurationToClock_(iso) {
  if (!iso) return '';
  var m = String(iso).match(
    /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/
  );
  if (!m) return iso;
  var h = Number(m[1] || 0);
  var min = Number(m[2] || 0);
  var s = Number(m[3] || 0);
  var pad = function (n) {
    return (n < 10 ? '0' : '') + n;
  };
  if (h > 0) {
    return h + ':' + pad(min) + ':' + pad(s);
  }
  return min + ':' + pad(s);
}

/**
 * Pull all videos for the configured channel.
 * @return {{channel: Object, rows: Array[]}}
 */
function pullChannelVideos_() {
  var cfg = getSyncConfig_();
  var channel = resolveChannel_(cfg);
  var ids = listUploadVideoIds_(channel.uploadsPlaylistId);
  var rows = fetchVideoDetails_(ids);

  rows.sort(function (a, b) {
    var da = a[4] ? new Date(a[4]).getTime() : 0;
    var db = b[4] ? new Date(b[4]).getTime() : 0;
    return db - da;
  });

  return { channel: channel, rows: rows };
}
