/**
 * YouTube Data API helpers (Apps Script Advanced Service: YouTube v3).
 *
 * Private / scheduled videos are only returned when the OAuth user is an
 * owner or manager of that channel AND we resolve the channel via mine
 * (or an authorized uploads playlist). Owning the Google Sheet alone is
 * not enough — YouTube authorization is separate from Sheets.
 */

/**
 * Resolve uploads playlist for the configured channel.
 * Prefers mine-matching managed channels so scheduled/private are visible.
 * @param {Object} cfg from getSyncConfig_()
 * @return {{channelId: string, uploadsPlaylistId: string, title: string, authPath: string}}
 */
function resolveChannel_(cfg) {
  var mode = (cfg.authMode || 'auto').toLowerCase();
  var mineMatch = findManagedChannel_(cfg);

  if (mode === 'mine') {
    if (!mineMatch) {
      throw new Error(
        'auth_mode=mine but no managed channel matched handle/id.\n' +
          'Use YouTube BOM → List my YouTube channels, then set channel_id.\n' +
          'If the channel is a Brand Account, re-authorize as that brand manager.'
      );
    }
    return mineMatch;
  }

  if (mode === 'auto' && mineMatch) {
    return mineMatch;
  }

  return resolveChannelPublic_(cfg);
}

/**
 * Channels the signed-in user owns/manages (includes private uploads access).
 * @param {Object} cfg
 * @return {Object|null}
 */
function findManagedChannel_(cfg) {
  var wantId = String(cfg.channelId || '').trim();
  var wantHandle = String(cfg.channelHandle || '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase();

  var pageToken = null;
  do {
    var opts = {
      mine: true,
      maxResults: 50
    };
    if (pageToken) {
      opts.pageToken = pageToken;
    }

    var response = YouTube.Channels.list('snippet,contentDetails', opts);
    var items = response.items || [];

    for (var i = 0; i < items.length; i++) {
      var ch = items[i];
      var customUrl = normalizeHandle_(
        (ch.snippet && ch.snippet.customUrl) || ''
      );
      var title = ((ch.snippet && ch.snippet.title) || '').toLowerCase();
      var idMatch = wantId && ch.id === wantId;
      var handleMatch =
        wantHandle &&
        (customUrl === wantHandle ||
          customUrl === wantHandle.toLowerCase() ||
          title.indexOf(wantHandle) !== -1);

      if (idMatch || handleMatch || (!wantId && !wantHandle && items.length === 1)) {
        return channelResult_(ch, 'mine (managed channel)');
      }
    }

    pageToken = response.nextPageToken || null;
  } while (pageToken);

  return null;
}

/**
 * Public resolution via channel id or handle (typically public videos only).
 * @param {Object} cfg
 * @return {Object}
 */
function resolveChannelPublic_(cfg) {
  var response;

  if (cfg.channelId) {
    response = YouTube.Channels.list('snippet,contentDetails', {
      id: cfg.channelId
    });
  } else if (cfg.channelHandle) {
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

  return channelResult_(
    response.items[0],
    'public handle/id (scheduled/private usually hidden)'
  );
}

function channelResult_(ch, authPath) {
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
    title: (ch.snippet && ch.snippet.title) || ch.id,
    customUrl: normalizeHandle_((ch.snippet && ch.snippet.customUrl) || ''),
    authPath: authPath
  };
}

function normalizeHandle_(value) {
  return String(value || '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase();
}

/**
 * Debug helper: show channels visible to the signed-in YouTube identity.
 */
function listMyYouTubeChannels() {
  var lines = [];
  var pageToken = null;

  do {
    var opts = { mine: true, maxResults: 50 };
    if (pageToken) {
      opts.pageToken = pageToken;
    }
    var response = YouTube.Channels.list('snippet,contentDetails', opts);
    var items = response.items || [];
    for (var i = 0; i < items.length; i++) {
      var ch = items[i];
      var handle = (ch.snippet && ch.snippet.customUrl) || '(no handle)';
      var title = (ch.snippet && ch.snippet.title) || '';
      lines.push(title + ' | @' + handle + ' | ' + ch.id);
    }
    pageToken = response.nextPageToken || null;
  } while (pageToken);

  var msg = lines.length
    ? 'Managed channels for this Google account:\n\n' + lines.join('\n')
    : 'No channels returned for mine:true.\n' +
      'This Google account is not an owner/manager in the YouTube API sense,\n' +
      'or you need to re-authorize after accepting YouTube permissions.';

  SpreadsheetApp.getUi().alert(msg);
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

    var page = YouTube.PlaylistItems.list('contentDetails,status', opts);
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
 * @return {Array[]}
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
  // Scheduled uploads are private/unlisted with a future publishAt.
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
    // Plain-language duration so Sheets does not coerce "5:32" into a time serial.
    iso8601DurationToHuman_(durationIso),
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
 * Convert ISO-8601 duration (PT#H#M#S) to "5m 32s" / "1h 02m 03s".
 * Avoids Google Sheets treating "5:32" as a clock time (fraction of a day).
 * @param {string} iso
 * @return {string}
 */
function iso8601DurationToHuman_(iso) {
  if (!iso) return '';
  var m = String(iso).match(
    /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/
  );
  if (!m) return iso;
  var h = Number(m[1] || 0);
  var min = Number(m[2] || 0);
  var s = Number(m[3] || 0);
  var parts = [];
  if (h > 0) parts.push(h + 'h');
  if (min > 0 || h > 0) parts.push(min + 'm');
  parts.push(s + 's');
  return parts.join(' ');
}

/**
 * Count status labels for the sync summary.
 * @param {Array[]} rows
 * @return {string}
 */
function summarizeStatuses_(rows) {
  var counts = {};
  for (var i = 0; i < rows.length; i++) {
    var s = String(rows[i][3] || 'unknown');
    counts[s] = (counts[s] || 0) + 1;
  }
  var keys = Object.keys(counts).sort();
  var parts = [];
  for (var k = 0; k < keys.length; k++) {
    parts.push(keys[k] + '=' + counts[keys[k]]);
  }
  return parts.join(', ') || 'none';
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
