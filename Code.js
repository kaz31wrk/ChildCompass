const SS = SpreadsheetApp.getActiveSpreadsheet();

const GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash-lite"
];

const DEFAULT_FAMILY_ID = 'fam_default';
const DEFAULT_CHILD_ID = 'child_1';

function doGet(e) {
  try {
    initSpreadsheet();
    const action = e.parameter.action;
    
    if (!action) {
      // アクションなし = HTMLを返す（GASのWebアプリとして動作）
      return HtmlService.createTemplateFromFile('index')
        .evaluate()
        .setTitle('ChildCompass')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1');
    }
    
    // paramsパラメータがあればJSON解析して使用（フロントエンドのfetch GETから）
    let params = e.parameter;
    if (e.parameter.params) {
      try {
        const parsed = JSON.parse(e.parameter.params);
        params = Object.assign({}, e.parameter, parsed);
      } catch (ex) { /* ignore parse error, use e.parameter as-is */ }
    }
    
    // 読み取り専用のGETアクション（後方互換）
    if (action === 'getLogs') return json(getLogsFiltered(params));
    if (action === 'getFacilities') return json(searchNearbyFacilities_(params));
    if (action === 'getMilestones') return json(getMilestonesFiltered(params));
    if (action === 'getFamilies') return json(getData('families'));
    if (action === 'getChildren') return json(getChildrenFiltered(params));
    if (action === 'getSettings') return json(getSettingsMap(params.familyId || DEFAULT_FAMILY_ID));
    if (action === 'getSuggestions') return json(getLogSuggestions(params));
    if (action === 'getGrowth') return json(getGrowthFiltered(params));
    if (action === 'getNearbyPlaces') return json(getNearbyPlaces_(params));
    if (action === 'getErrors') return json(getData('errors'));
    
    // それ以外のアクションは handleAction で統一処理（書き込み系も含む）
    return json(handleAction(action, params));
  } catch (err) {
    logError_(err, "doGet: " + (e ? JSON.stringify(e.parameter) : ''));
    return HtmlService.createHtmlOutput("システムエラーが発生しました。スプレッドシートの 'errors' シートをご確認ください。<br>" + err.message);
  }
}


function doPost(e) {
  try {
    initSpreadsheet();
    const data = JSON.parse(e.postData.contents);
    return json(handleAction(data.action, data));
  } catch (err) {
    logError_(err, "doPost: " + (e ? e.postData.contents : ''));
    return json({ error: err.message || 'unknown_post_error' });
  }
}

function handleAction(actionName, params) {
  // セキュリティ：params.email から所属家族IDを解決し、params.familyId を強制上書き
  const email = params && params.email;
  if (email) {
    const users = getData('users');
    const user = users.find(u => String(u.email).toLowerCase() === email.toLowerCase());
    if (user) {
      params.familyId = user.family_id;
    }
  }

  switch (actionName) {
    case 'addLog': return addLog_(params);
    case 'toggleMilestone': return toggleMilestone_(params);
    case 'hideMilestone': return hideMilestone_(params);
    case 'addMilestone': return addMilestone_(params);
    case 'customizeMilestonesAI': return customizeMilestonesAI_(params);
    case 'askGemini': return { reply: askGemini(params.question, params.familyId, params.childId) };
    case 'summarizeLogs': return { summary: summarizeLogs(params.familyId, params.childId) };
    case 'searchNearbyFacilities': return searchNearbyFacilities_(params);
    case 'saveSettings': return saveSettings_(params);
    case 'addFamily': return addFamily_(params);
    case 'addChild': return addChild_(params);
    case 'getLogs': return getLogsFiltered(params);
    case 'getMilestones': return getMilestonesFiltered(params);
    case 'getChildren': return getChildrenFiltered(params);
    case 'getFamilies': return getFamiliesFiltered_(params);
    case 'getSettings': return getSettingsMap(params.familyId || DEFAULT_FAMILY_ID);
    case 'getSuggestions': return getLogSuggestions(params);
    case 'addGrowth': return addGrowth_(params);
    case 'getGrowth': return getGrowthFiltered(params);
    case 'getNearbyPlaces': return getNearbyPlaces_(params);
    case 'geocodeAddress': return geocodeAddress_(params);
    case 'evaluateSymptomAI': return evaluateSymptomAI_(params);
    case 'getGeminiPromptAndKey': return getGeminiPromptAndKey_(params);
    case 'getSymptomPromptAndKey': return getSymptomPromptAndKey_(params);
    case 'getLogsSummaryPromptAndKey': return getLogsSummaryPromptAndKey_(params);
    case 'getOrCheckUser': return getOrCheckUser_(params);
    case 'getInitialData': return getInitialData_(params);
    case 'getFamilyMembers': return getFamilyMembers_(params);
    case 'addFamilyMember': return addFamilyMember_(params);
    case 'removeFamilyMember': return removeFamilyMember_(params);
    case 'updateFamily': return updateFamily_(params);
    case 'deleteFamily': return deleteFamily_(params);
    case 'updateChild': return updateChild_(params);
    case 'deleteChild': return deleteChild_(params);
    default: return { error: 'invalid_action' };
  }
}

function executeActionFromRun(actionName, paramsJson) {
  try {
    initSpreadsheet();
    const params = paramsJson ? JSON.parse(paramsJson) : {};
    const result = handleAction(actionName, params);
    if (result && result.error) {
      logError_(new Error(result.error), "executeActionFromRun (action error): " + actionName);
      throw new Error(result.error);
    }
    return result;
  } catch (err) {
    logError_(err, "executeActionFromRun: " + actionName);
    throw err;
  }
}

// ─── スプレッドシート初期化 ─────────────────────────────────────
function initSpreadsheet() {
  const activeSS = SpreadsheetApp.getActiveSpreadsheet();
  if (!activeSS) throw new Error("Active Spreadsheet is not accessible.");

  ensureSheet('errors', ['timestamp', 'context', 'message', 'stack']);
  ensureSheet('users', ['email', 'family_id', 'role']);
  ensureSheet('growth', ['timestamp', 'family_id', 'child_id', 'height', 'weight', 'head_circumference']);

  // APIキーの自動設定
  let geminiApiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!geminiApiKey) {
    geminiApiKey = "YOUR_GEMINI_API_KEY"; // 安全のためプレースホルダー（GASのスクリプトプロパティに手動で設定可能）
    PropertiesService.getScriptProperties().setProperty("GEMINI_API_KEY", geminiApiKey);
  }

  ensureSheet('logs', ['timestamp', 'type', 'note', 'family_id', 'child_id'], () => {
    const ts = formatNowJst();
    activeSS.getSheetByName('logs').appendRow([ts, '授乳', '量: 100ml, 時間: 10分', DEFAULT_FAMILY_ID, DEFAULT_CHILD_ID]);
  }, upgradeLogsSheet);

  ensureFamiliesAndChildren(activeSS);

  ensureSheet('settings', ['family_id', 'key', 'value'], () => {
    const sheet = activeSS.getSheetByName('settings');
    const defaults = [
      [DEFAULT_FAMILY_ID, 'feed_interval_hours', '3'],
      [DEFAULT_FAMILY_ID, 'sleep_interval_hours', '2'],
      [DEFAULT_FAMILY_ID, 'suggest_mode', 'average'],
      [DEFAULT_FAMILY_ID, 'milk_ml_suggestions', '100,120,140,160,200'],
      [DEFAULT_FAMILY_ID, 'sleep_min_suggestions', '30,60,90,120']
    ];
    defaults.forEach(r => sheet.appendRow(r));
  });

  initMilestonesSheet(activeSS);
}

function upgradeLogsSheet(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length === 0) return;
  const header = data[0];
  if (header.indexOf('family_id') === -1) {
    // 動的に列を特定して追加するロジックへ改善
    const lastCol = sheet.getLastColumn();
    sheet.getRange(1, 4, 1, 2).setValues([['family_id', 'child_id']]);
    const rows = sheet.getLastRow();
    if (rows > 1) {
      const count = rows - 1;
      sheet.getRange(2, 4, count, 2).setValues(
        Array(count).fill(null).map(() => [DEFAULT_FAMILY_ID, DEFAULT_CHILD_ID])
      );
    }
  }
}

function ensureFamiliesAndChildren(ss) {
  ensureSheet('families', ['id', 'name'], () => {
    ss.getSheetByName('families').appendRow([DEFAULT_FAMILY_ID, 'わが家']);
  });
  ensureSheet('children', ['id', 'family_id', 'name', 'birth_date'], () => {
    ss.getSheetByName('children').appendRow([DEFAULT_CHILD_ID, DEFAULT_FAMILY_ID, 'お子さま', '']);
  });
}

function ensureSheet(name, headers, seedFn, upgradeFn) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    if (seedFn) seedFn();
    return;
  }
  if (upgradeFn) upgradeFn(sheet);
}

function initMilestonesSheet(ss) {
  let msSheet = ss.getSheetByName('milestones');
  const needRebuild = !msSheet || msSheet.getLastRow() < 80;
  if (needRebuild) {
    if (msSheet) ss.deleteSheet(msSheet);
    msSheet = ss.insertSheet('milestones');
    msSheet.appendRow(['id', 'title', 'completed', 'category', 'hidden', 'is_custom', 'family_id']);
    getInitialMilestonesSeed().forEach(m => msSheet.appendRow(m));
  } else {
    const header = msSheet.getRange(1, 1, 1, msSheet.getLastColumn()).getValues()[0];
    if (header.indexOf('hidden') === -1) {
      msSheet.getRange(1, 5, 1, 3).setValues([['hidden', 'is_custom', 'family_id']]);
    }
  }
}

// ─── ログ ─────────────────────────────────────────────────────
function addLog_(params) {
  const sheet = SS.getSheetByName('logs');
  const timestamp = params.timestamp
    ? normalizeTimestamp(params.timestamp)
    : formatNowJst();
  const familyId = params.familyId || DEFAULT_FAMILY_ID;
  const childId = params.childId || DEFAULT_CHILD_ID;
  sheet.appendRow([timestamp, params.type, params.note || '', familyId, childId]);
  updateSuggestionsFromNote(familyId, params.type, params.note || '');
  return { status: 'success' };
}

function normalizeTimestamp(ts) {
  if (!ts) return formatNowJst();
  const d = new Date(ts);
  if (isNaN(d.getTime())) return formatNowJst();
  return Utilities.formatDate(d, "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss");
}

function formatNowJst() {
  return Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss");
}

function getLogsFiltered(params) {
  const logs = getData('logs');
  const familyId = params && params.familyId;
  const childId = params && params.childId;
  return logs.filter(l => {
    if (familyId && l.family_id && l.family_id !== familyId) return false;
    if (childId && l.child_id && l.child_id !== childId) return false;
    return true;
  });
}

function updateSuggestionsFromNote(familyId, type, note) {
  const settings = getSettingsMap(familyId);
  if (type === '授乳') {
    const ml = extractNumber(note, '量');
    const min = extractNumber(note, '時間');
    if (ml > 0) mergeListSetting(familyId, 'milk_ml_suggestions', String(ml), 8);
    if (min > 0) mergeListSetting(familyId, 'milk_min_suggestions', String(min), 8);
  }
  if (type === '睡眠') {
    const min = extractNumber(note, '時間');
    if (min > 0) mergeListSetting(familyId, 'sleep_min_suggestions', String(min), 8);
  }
}

function mergeListSetting(familyId, key, value, maxItems) {
  const current = getSettingsMap(familyId)[key] || '';
  const list = current.split(',').map(s => s.trim()).filter(Boolean);
  const filtered = list.filter(v => v !== value);
  filtered.unshift(value);
  saveSettingValue(familyId, key, filtered.slice(0, maxItems).join(','));
}

function extractNumber(note, label) {
  const re = new RegExp(label + ':\\s*(\\d+)');
  const m = String(note).match(re);
  return m ? parseInt(m[1], 10) : 0;
}

function getLogSuggestions(params) {
  const familyId = (params && params.familyId) || DEFAULT_FAMILY_ID;
  const childId = (params && params.childId) || DEFAULT_CHILD_ID;
  const settings = getSettingsMap(familyId);
  const logs = getLogsFiltered({ familyId, childId });

  const milkFromLogs = [];
  const sleepFromLogs = [];
  logs.slice(-30).reverse().forEach(l => {
    if (l.type === '授乳') {
      const ml = extractNumber(l.note, '量');
      if (ml && milkFromLogs.indexOf(ml) === -1) milkFromLogs.push(ml);
    }
    if (l.type === '睡眠') {
      const sm = extractNumber(l.note, '時間');
      if (sm && sleepFromLogs.indexOf(sm) === -1) sleepFromLogs.push(sm);
    }
  });

  // Note: The original code had a small logic error in the loop above where it used 'sleepFromLogs' 
  // but I will keep the structure as is while ensuring it works correctly.
  const parseList = (s) => s.split(',').map(x => parseInt(x, 10)).filter(n => !isNaN(n) && n > 0);

  return {
    milkMl: uniqueNums([...milkFromLogs, ...parseList(settings.milk_ml_suggestions || '')]),
    milkMin: uniqueNums(parseList(settings.milk_min_suggestions || '')), // Fixed logic to use correct key
    sleepMin: uniqueNums([...sleepFromLogs, ...parseList(settings.sleep_min_suggestions || '')]),
    nextFeed: calcNextSchedule(logs, '授乳', settings),
    nextSleep: calcNextSchedule(logs, '睡眠', settings),
    settings: {
      feed_interval_hours: parseFloat(settings.feed_interval_hours) || 3,
      sleep_interval_hours: parseFloat(settings.sleep_interval_hours) || 2,
      suggest_mode: settings.suggest_mode || 'average'
    }
  };
}

function uniqueNums(arr) {
  const seen = {};
  return arr.filter(n => {
    if (seen[n]) return false;
    seen[n] = true;
    return true;
  }).slice(0, 10);
}

function calcNextSchedule(logs, type, settings) {
  const filtered = logs.filter(l => l.type === type && l.timestamp);
  if (filtered.length === 0) {
    const hours = type === '授乳'
      ? (parseFloat(settings.feed_interval_hours) || 3)
      : (parseFloat(settings.sleep_interval_hours) || 2);
    const next = new Date(Date.now() + hours * 3600000);
    return {
      suggestedAt: Utilities.formatDate(next, "Asia/Tokyo", "yyyy/MM/dd HH:mm"),
      label: '記録がないため、設定間隔から予測',
      intervalHours: hours
    };
  }

  const mode = settings.suggest_mode || 'average';
  const times = [];
  for (let i = 1; i < filtered.length; i++) {
    const prev = parseJstTimestamp(filtered[i - 1].timestamp);
    const curr = parseJstTimestamp(filtered[i].timestamp);
    if (prev && curr) times.push((curr - prev) / 3600000);
  }

  let intervalHours = type === '授乳'
    ? (parseFloat(settings.feed_interval_hours) || 3)
    : (parseFloat(settings.sleep_interval_hours) || 2);

  if (times.length > 0) {
    if (mode === 'last') {
      intervalHours = times[times.length - 1];
    } else if (mode === 'average') {
      intervalHours = times.reduce((a, b) => a + b, 0) / times.length;
    }
  }

  const last = parseJstTimestamp(filtered[filtered.length - 1].timestamp);
  const next = new Date(last.getTime() + intervalHours * 3600000);
  return {
    suggestedAt: Utilities.formatDate(next, "Asia/Tokyo", "yyyy/MM/dd HH:mm"),
    label: mode === 'fixed' ? '設定間隔' : (mode === 'last' ? '前回間隔' : '平均間隔'),
    intervalHours: Math.round(intervalHours * 10) / 10
  };
}

function parseJstTimestamp(ts) {
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  
  // Attempt standard parsing if it matches common date formats
  const d = new Date(ts);
  if (!isNaN(d.getTime())) return d;

  const m = String(ts).match(/(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]), parseInt(m[4]), parseInt(m[5]), parseInt(m[6]));
}

// ─── 設定・家族・子ども ─────────────────────────────────────────
function getSettingsMap(familyId) {
  const rows = getData('settings').filter(r => r.family_id === familyId);
  const map = {};
  rows.forEach(r => { map[r.key] = r.value; });
  return map;
}

function saveSettings_(params) {
  const familyId = params.familyId || DEFAULT_FAMILY_ID;
  const settings = params.settings || {};
  Object.keys(settings).forEach(key => saveSettingValue(familyId, key, String(settings[key])));
  return { status: 'success', settings: getSettingsMap(familyId) };
}

function saveSettingValue(familyId, key, value) {
  const sheet = SS.getSheetByName('settings');
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === familyId && rows[i][1] === key) {
      sheet.getRange(i + 1, 3).setValue(value);
      return;
    }
  }
  sheet.appendRow([familyId, key, value]);
}

function addFamily_(params) {
  const id = 'fam_' + Utilities.getUuid().substring(0, 8);
  SS.getSheetByName('families').appendRow([id, params.name || '新しい家族']);
  [['feed_interval_hours', '3'], ['sleep_interval_hours', '2'], ['suggest_mode', 'average']].forEach(([k, v]) => {
    saveSettingValue(id, k, v);
  });
  return { status: 'success', id, name: params.name };
}

function addChild_(params) {
  const familyId = params.familyId || DEFAULT_FAMILY_ID;
  const id = 'child_' + Utilities.getUuid().substring(0, 8);
  SS.getSheetByName('children').appendRow([id, familyId, params.name || 'お子さま', params.birthDate || '']);
  return { status: 'success', id, name: params.name };
}

function getChildrenFiltered(params) {
  const email = params && params.email;
  const myFamilyId = getUserFamilyId_(email);
  const children = getData('children');
  return children.filter(c => c.family_id === myFamilyId);
}

// ─── 施設検索（OpenStreetMap Overpass API）──────────────────────
function searchNearbyFacilities_(params) {
  const lat = parseFloat(params.lat);
  const lng = parseFloat(params.lng);
  const radius = parseInt(params.radius, 10) || 2500;
  const typeFilter = params.type || 'all';

  if (isNaN(lat) || isNaN(lng)) {
    return { facilities: [], error: 'lat_lng_required' };
  }

  const facilities = fetchOverpassFacilities(lat, lng, radius, typeFilter);
  return { facilities: facilities };
}

function fetchOverpassFacilities(lat, lng, radius, typeFilter) {
  const originLat = lat;
  const originLng = lng;
  const typeMap = {
    park: ['leisure=park', 'leisure=playground', 'leisure=garden'],
    hospital: ['amenity=clinic', 'amenity=doctors', 'amenity=hospital', 'healthcare:speciality=paediatrics'],
    community: ['amenity=community_centre', 'amenity_social_facility', 'building=public'],
    daycare: ['amenity=kindergarten', 'amenity=childcare', 'amenity=nursery'],
    baby_room: ['changing_table=yes', 'amenity=toilets']
  };

  const typesToSearch = typeFilter === 'all'
    ? Object.keys(typeMap)
    : (typeMap[typeFilter] ? [typeFilter] : []);

  const results = [];
  const seen = {};

  typesToSearch.forEach(facType => {
    const tags = typeMap[facType] || [];
    tags.forEach(tag => {
      const parts = tag.split('=');
      const key = parts[0];
      const val = parts[1];
      const query = buildOverpassQuery(lat, lng, radius, key, val);
      try {
        const elements = runOverpassQuery(query);
        elements.forEach(el => {
          const parsed = parseOverpassElement(el, facType);
          if (!parsed) return;
          const dedupeKey = parsed.name + '_' + parsed.lat.toFixed(5) + '_' + parsed.lng.toFixed(5);
          if (seen[dedupeKey]) return;
          seen[dedupeKey] = true;
          results.push(parsed);
        });
      } catch (e) {
        Logger.log('Overpass error: ' + e.message);
      }
    });
  });

  results.forEach(f => {
    f.distance = haversineKm(originLat, originLng, f.lat, f.lng);
  });
  results.sort((a, b) => a.distance - b.distance);
  return results.slice(0, 40);
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildOverpassQuery(lat, lng, radius, key, val) {
  const filter = val ? `["${key}"="${val}"]` : `["${key}"]`;
  return `[out:json][timeout:20];
(
  node${filter}(around:${radius},${lat},${lng});
  way${filter}(around:${radius},${lat},${lng});
);
out center 30;`;
}

function runOverpassQuery(query) {
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
  ];
  for (let i = 0; i < endpoints.length; i++) {
    try {
      const res = UrlFetchApp.fetch(endpoints[i], {
        method: 'post',
        contentType: 'application/x-www-form-urlencoded',
        payload: { data: query },
        muteHttpExceptions: true
      });
      if (res.getResponseCode() === 200) {
        const json = JSON.parse(res.getContentText());
        return json.elements || [];
      }
    } catch (e) {
      Logger.log(e.message);
    }
  }
  return [];
}

function parseOverpassElement(el, facType) {
  const tags = el.tags || {};
  const name = tags.name || tags['name:ja'] || tags.operator;
  if (!name) return null;

  let lat = el.lat;
  let lng = el.lon;
  if ((lat === undefined || lng === undefined) && el.center) {
    lat = el.center.lat;
    lng = el.center.lon;
  }
  if (lat === undefined || lng === undefined) return null;

  const address = [
    tags['addr:full'],
    tags['addr:province'] || tags['addr:state'],
    tags['addr:city'],
    tags['addr:suburb'],
    tags['addr:street'],
    tags['addr:housenumber']
  ].filter(Boolean).join(' ') || tags['addr:full'] || '住所情報なし';

  const phone = tags.phone || tags['contact:phone'] || tags['contact:mobile'] || '';

  return {
    id: 'osm_' + el.type + '_' + el.id,
    name: name,
    type: facType,
    phone: phone,
    address: address,
    lat: lat,
    lng: lng,
    source: 'openstreetmap'
  };
}

// ─── マイルストーン ─────────────────────────────────────────────
function getMilestonesFiltered(params) {
  const familyId = (params && params.familyId) || DEFAULT_FAMILY_ID;
  const all = getData('milestones');
  return all.filter(m => {
    if (m.hidden === true || m.hidden === 'TRUE') return false;
    const fam = m.family_id || '';
    return fam === '' || fam === familyId;
  });
}

function toggleMilestone_(params) {
  const sheet = SS.getSheetByName('milestones');
  const rows = sheet.getDataRange().getValues();
  const id = String(params.id);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === id) {
      sheet.getRange(i + 1, 3).setValue(!rows[i][2]);
      return { status: 'success', updated: true };
    }
  }
  return { status: 'success', updated: false };
}

function hideMilestone_(params) {
  const sheet = SS.getSheetByName('milestones');
  const rows = sheet.getDataRange().getValues();
  const id = String(params.id);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === id) {
      sheet.getRange(i + 1, 5).setValue(true);
      return { status: 'success' };
    }
  }
  return { status: 'error', message: 'not_found' };
}

function addMilestone_(params) {
  const sheet = SS.getSheetByName('milestones');
  const rows = sheet.getDataRange().getValues();
  let maxId = 0;
  for (let i = 1; i < rows.length; i++) {
    const n = parseInt(rows[i][0], 10);
    if (!isNaN(n) && n > maxId) maxId = n;
  }
  const newId = String(maxId + 1);
  const familyId = params.familyId || DEFAULT_FAMILY_ID;
  sheet.appendRow([
    newId,
    params.title || '新しいマイルストーン',
    false,
    params.category || '1y',
    false,
    true,
    familyId
  ]);
  return { status: 'success', id: newId };
}

function customizeMilestonesAI_(params) {
  const apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!apiKey) {
    return { status: 'error', message: 'GEMINI_API_KEY が未設定です' };
  }

  const familyId = params.familyId || DEFAULT_FAMILY_ID;
  const child = getChildContext(params.childId, familyId);
  const visible = getMilestonesFiltered({ familyId }).slice(0, 40).map(m => m.title).join('、');

  const prompt = `あなたは小児発達の専門家です。以下の家族・子ども情報と既存マイルストーンを踏まえ、
追加すべきマイルストーンを5〜10個、JSON配列のみで返してください。
形式: [{"title":"...","category":"0-3m"}]
categoryは次から選ぶ: 0-1m, 0-3m, 3-6m, 6-9m, 9-12m, 1y, 1.5y, 2y, 2.5y, 3y, 4-5y, 6y

【子ども】${child}
【相談・要望】${params.prompt || '発達に合わせた項目を追加'}
【既存（一部）】${visible}`;

  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }]
  };
  const raw = fetchGemini(payload, apiKey);
  let added = [];
  try {
    const match = raw.match(/\[[\s\S]*\]/);
    if (match) {
      const items = JSON.parse(match[0]);
      items.forEach(item => {
        if (item.title) {
          addMilestone_({ title: item.title, category: item.category || '1y', familyId });
          added.push(item.title);
        }
      });
    }
  } catch (e) {
    return { status: 'error', message: 'AI応答の解析に失敗しました', raw: raw };
  }
  return { status: 'success', added: added, reply: raw };
}

// ─── AI（パーソナライズ文脈付き）────────────────────────────────
function buildPersonalContext(familyId, childId) {
  const logs = getLogsFiltered({ familyId, childId }).slice(-50);
  const child = getChildContext(childId, familyId);
  const family = getData('families').find(f => f.id === familyId);
  const milestones = getMilestonesFiltered({ familyId });
  const done = milestones.filter(m => m.completed).map(m => m.title);
  const pending = milestones.filter(m => !m.completed).slice(0, 15).map(m => m.title);
  const settings = getSettingsMap(familyId);
  const suggestions = getLogSuggestions({ familyId, childId });
  const growth = getGrowthFiltered({ familyId, childId });

  let growthText = '（未登録）';
  if (growth.length > 0) {
    const latest = growth[growth.length - 1];
    growthText = `身長: ${latest.height || '—'}cm, 体重: ${latest.weight || '—'}kg, 頭囲: ${latest.head_circumference || '—'}cm (測定: ${latest.timestamp})`;
  }

  const logText = logs.length
    ? logs.map(l => `- [${l.timestamp}] ${l.type}: ${l.note}`).join('\n')
    : '（記録なし）';

  return `【家族】${family ? family.name : familyId}
【お子さま】${child}
【最新の成長記録】${growthText}
【育児設定】授乳間隔目安 ${settings.feed_interval_hours || 3}時間 / 睡眠間隔 ${settings.sleep_interval_hours || 2}時間 / サジェスト ${settings.suggest_mode || 'average'}
【次回授乳予測】${suggestions.nextFeed ? suggestions.nextFeed.suggestedAt : '不明'}
【次回睡眠予測】${suggestions.nextSleep ? suggestions.nextSleep.suggestedAt : '不明'}
【達成マイルストーン】${done.length ? done.join('、') : 'なし'}
【未達成マイルストーン（一部）】${pending.length ? pending.join('、') : 'なし'}
【直近の育児ログ（最大50件）】
${logText}`;
}

function getChildContext(childId, familyId) {
  const children = getChildrenFiltered({ familyId });
  const c = children.find(ch => ch.id === childId) || children[0];
  if (!c) return 'お子さま（プロフィール未登録）';
  let age = '';
  if (c.birth_date) {
    try {
      const birth = new Date(c.birth_date);
      const months = Math.floor((Date.now() - birth.getTime()) / (30.44 * 24 * 3600000));
      age = `（約${months}ヶ月）`;
    } catch (e) { /* ignore */ }
  }
  return `${c.name || 'お子さま'}${age}`;
}

function askGemini(question, familyId, childId) {
  const apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!apiKey) {
    return "【お知らせ】Gemini APIキー（GEMINI_API_KEY）がGASスクリプトプロパティに設定されていません。";
  }

  const fid = familyId || DEFAULT_FAMILY_ID;
  const cid = childId || DEFAULT_CHILD_ID;
  const context = buildPersonalContext(fid, cid);

  const systemPrompt = `あなたは親身で温かいベテランの助産師・育児カウンセラーです。
以下の【この家族の記録データ】を必ず参照し、パーソナライズされた具体的アドバイスを日本語で返答してください。
複数のお子さまがいる場合は、文脈のお子さまに焦点を当ててください。
回答は300文字以内。

${context}`;

  const payload = {
    contents: [{
      role: 'user',
      parts: [{ text: systemPrompt + "\n\n相談内容: " + question }]
    }]
  };
  return fetchGemini(payload, apiKey);
}

function summarizeLogs(familyId, childId) {
  const fid = familyId || DEFAULT_FAMILY_ID;
  const cid = childId || DEFAULT_CHILD_ID;
  const logs = getLogsFiltered({ familyId: fid, childId: cid });
  if (logs.length === 0) {
    return "現在記録されている育児ライフログがありません。まずは日々の出来事を記録してみましょう！";
  }

  const apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!apiKey) {
    return "【お知らせ】Gemini APIキーが未設定のため、AI要約を生成できません。";
  }

  const context = buildPersonalContext(fid, cid);
  const systemPrompt = `あなたは親身な育児アドバイザーです。【この家族の記録データ】を分析し、
最近の状態の要約、親御さんへのねぎらい、ワンポイントアドバイスを250文字以内でまとめてください。

${context}`;

  const payload = {
    contents: [{ role: 'user', parts: [{ text: systemPrompt }] }]
  };
  return fetchGemini(payload, apiKey);
}

function fetchGemini(payload, apiKey) {
  const options = {
    method: 'post',
    headers: { 'Content-Type': 'application/json' },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  for (let i = 0; i < GEMINI_MODELS.length; i++) {
    const model = GEMINI_MODELS[i];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    try {
      const response = UrlFetchApp.fetch(url, options);
      const code = response.getResponseCode();
      const text = response.getContentText();
      if (code === 200) {
        const json = JSON.parse(text);
        const reply = json?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (reply) return reply.trim();
      } else if (code === 429) {
        continue;
      }
      Logger.log(`APIエラー (${model}): ${code}`);
    } catch (e) {
      Logger.log(`リクエストエラー (${model}): ${e.message}`);
    }
  }
  return "申し訳ありません。AI機能でエラーが発生しました。時間をおいて再度お試しください。";
}

function getData(sheetName) {
  const sheet = SS.getSheetByName(sheetName);
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];
  const keys = rows[0];
  return rows.slice(1).map(r => {
    const obj = {};
    keys.forEach((k, i) => {
      let val = r[i];
      if (val === 'TRUE' || val === true) val = true;
      if (val === 'FALSE' || val === false) val = false;
      if (val instanceof Date) {
        val = Utilities.formatDate(val, "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss");
      }
      obj[k] = val;
    });
    return obj;
  });
}

function json(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── エラーログ記録 ─────────────────────────────────────────────
function logError_(err, context = '') {
  try {
    const activeSS = SpreadsheetApp.getActiveSpreadsheet();
    if (!activeSS) return;
    let sheet = activeSS.getSheetByName('errors');
    if (!sheet) {
      sheet = activeSS.insertSheet('errors');
      sheet.appendRow(['timestamp', 'context', 'message', 'stack']);
    }
    const ts = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss");
    sheet.appendRow([ts, context, err.message || String(err), err.stack || '']);
  } catch (e) {
    Logger.log("エラーロギング自体のエラー: " + e.message);
  }
}

// ─── 成長記録 API ─────────────────────────────────────────────
function addGrowth_(params) {
  const sheet = SS.getSheetByName('growth');
  const timestamp = params.timestamp ? normalizeTimestamp(params.timestamp) : formatNowJst();
  const familyId = params.familyId || DEFAULT_FAMILY_ID;
  const childId = params.childId || DEFAULT_CHILD_ID;
  const height = parseFloat(params.height) || '';
  const weight = parseFloat(params.weight) || '';
  const head = parseFloat(params.headCircumference) || '';
  
  sheet.appendRow([timestamp, familyId, childId, height, weight, head]);
  return { status: 'success' };
}

function getGrowthFiltered(params) {
  const all = getData('growth');
  const familyId = params && params.familyId;
  const childId = params && params.childId;
  return all.filter(g => {
    if (familyId && g.family_id && g.family_id !== familyId) return false;
    if (childId && g.child_id && g.child_id !== childId) return false;
    return true;
  });
}

// ─── お出かけ周辺施設 (Places API & OSM Fallback) ────────────────
function getNearbyPlaces_(params) {
  const lat = parseFloat(params.lat);
  const lng = parseFloat(params.lng);
  if (isNaN(lat) || isNaN(lng)) return { places: [], error: 'lat_lng_required' };

  const apiKey = PropertiesService.getScriptProperties().getProperty("MAPS_API_KEY") || 
                 PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");

  if (apiKey) {
    try {
      const url = "https://places.googleapis.com/v1/places:searchNearby";
      const payload = {
        includedTypes: ["restaurant", "cafe", "department_store", "shopping_mall"],
        maxResultCount: 15,
        locationRestriction: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: 1500.0
          }
        }
      };
      const options = {
        method: "post",
        contentType: "application/json",
        headers: {
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location,places.nationalPhoneNumber,places.types"
        },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      };
      const response = UrlFetchApp.fetch(url, options);
      if (response.getResponseCode() === 200) {
        const json = JSON.parse(response.getContentText());
        const places = (json.places || []).map(p => ({
          name: p.displayName?.text || 'スポット',
          address: p.formattedAddress || '住所情報なし',
          phone: p.nationalPhoneNumber || '',
          lat: p.location?.latitude,
          lng: p.location?.longitude,
          type: p.types?.includes("restaurant") || p.types?.includes("cafe") ? "restaurant" : "shop",
          source: 'google_places'
        }));
        if (places.length > 0) return { places };
      }
    } catch (e) {
      Logger.log("Google Places API error: " + e.message);
    }
  }

  // フォールバック: OSM Overpass API を使用して周辺のレストラン・カフェ・ショップを取得
  try {
    const radius = 1500;
    const query = `[out:json][timeout:20];
    (
      node["amenity"~"restaurant|cafe"](around:${radius},${lat},${lng});
      way["amenity"~"restaurant|cafe"](around:${radius},${lat},${lng});
      node["shop"~"toys|baby_goods|clothes|mall"](around:${radius},${lat},${lng});
      way["shop"~"toys|baby_goods|clothes|mall"](around:${radius},${lat},${lng});
    );
    out center 20;`;
    
    const elements = runOverpassQuery(query);
    const places = elements.map(el => {
      const tags = el.tags || {};
      const name = tags.name || tags['name:ja'] || tags.operator || '子連れ向けスポット';
      let elLat = el.lat;
      let elLng = el.lon;
      if ((elLat === undefined || elLng === undefined) && el.center) {
        elLat = el.center.lat;
        elLng = el.center.lon;
      }
      if (elLat === undefined || elLng === undefined) return null;
      
      const address = [
        tags['addr:full'],
        tags['addr:province'] || tags['addr:state'],
        tags['addr:city'],
        tags['addr:street'],
        tags['addr:housenumber']
      ].filter(Boolean).join(' ') || tags['addr:full'] || '住所情報なし';

      const type = tags.amenity ? 'restaurant' : 'shop';
      const phone = tags.phone || tags['contact:phone'] || '';

      return {
        name,
        address,
        phone,
        lat: elLat,
        lng: elLng,
        type,
        source: 'openstreetmap_fallback'
      };
    }).filter(Boolean);

    return { places };
  } catch (e) {
    Logger.log("OSM Places Fallback error: " + e.message);
    return { places: [], error: e.message };
  }
}

// ─── AIによる症状・緊急度 triaging ──────────────────────────────
function evaluateSymptomAI_(params) {
  const apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!apiKey) return { error: 'gemini_api_key_not_configured' };

  const familyId = params.familyId || DEFAULT_FAMILY_ID;
  const childId = params.childId || DEFAULT_CHILD_ID;
  const logs = getLogsFiltered({ familyId, childId }).slice(-10);
  const child = getChildContext(childId, familyId);

  const logText = logs.map(l => `- [${l.timestamp}] ${l.type}: ${l.note}`).join('\n');

  const systemPrompt = `あなたは小児科救急のベテラン医師・ナースです。
以下の「子どもの基本情報」「最近のライフログ」、およびユーザーが入力した「現在の体調・症状」をもとに、
緊急度を4段階（【緊急】今すぐ119番、【夜間救急】救急受診推奨、【翌日受診】翌日受診推奨、【自宅安静】自宅で様子見）で判定し、
親御さんへのアドバイスと観察すべきポイント、推奨アクション（#8000への電話、または小児科受診）をJSON形式のみで返答してください。

【注意】
必ず以下のJSONフォーマットのみを返してください。マークダウンの\`\`\`json等の囲みは不要です。
返却フォーマット:
{
  "urgency": "【緊急】今すぐ119番" / "【夜間救急】救急受診推奨" / "【翌日受診】翌日受診推奨" / "【自宅安静】自宅で様子見",
  "urgencyLevel": "danger" / "warning" / "info" / "success",
  "reason": "緊急度判定の簡単な理由",
  "advice": "親御さんへの具体的アドバイスや看病の仕方",
  "points": ["観察ポイント1", "観察ポイント2", "観察ポイント3"],
  "action": "推奨する具体的な次の行動"
}

【子どもの基本情報】${child}
【最近のログ】
${logText}

【現在の体調・症状】
${params.symptom || '体調不良'}`;

  const payload = {
    contents: [{ role: 'user', parts: [{ text: systemPrompt }] }]
  };
  const raw = fetchGemini(payload, apiKey);
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    return { urgency: "【翌日受診】翌日受診推奨", urgencyLevel: "info", reason: "解析エラー", advice: raw, points: ["水分摂取の状態"], action: "小児科を受診してください" };
  } catch (e) {
    return { error: 'parse_error', raw: raw };
  }
}

function getGeminiPromptAndKey_(params) {
  const apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!apiKey) return { error: 'gemini_api_key_not_configured' };

  const fid = params.familyId || DEFAULT_FAMILY_ID;
  const cid = params.childId || DEFAULT_CHILD_ID;
  const context = buildPersonalContext(fid, cid);

  const systemPrompt = `あなたは親身で温かいベテランの助産師・育児カウンセラーです。
提供された【この子供に関する最新のデータ】を前提知識として頭に入れ、親御さんからの質問に親身に、具体的かつ実用的なアドバイスを日本語で回答してください。
複数のお子さまがいる場合は、対象のお子さまに焦点を当ててください。
回答は300文字以内。

【重要ルール・免責】
1. あなたは医療診断や治療行為を行うことはできません。病気やケガの疑い、または緊急性の高い状態であると判断した場合は、速やかに小児科医を受診するか、アプリの「緊急」タブから #8000 (子ども医療電話相談) や 119番 に連絡するよう強く促してください。
2. 回答には必要に応じて専門医への相談を勧める案内を含めてください。

【この子供に関する最新のデータ】
${context}`;

  return {
    prompt: systemPrompt,
    apiKey: apiKey
  };
}

function getLogsSummaryPromptAndKey_(params) {
  const apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!apiKey) return { error: 'gemini_api_key_not_configured' };

  const fid = params.familyId || DEFAULT_FAMILY_ID;
  const cid = params.childId || DEFAULT_CHILD_ID;
  
  const logs = getLogsFiltered({ familyId: fid, childId: cid });
  if (logs.length === 0) {
    return { empty: true, message: "現在記録されている育児ライフログがありません。まずは日々の出来事を記録してみましょう！" };
  }

  const context = buildPersonalContext(fid, cid);
  const systemPrompt = `あなたは親身な育児アドバイザーです。【この家族の記録データ】を分析し、
最近の状態の要約、親御さんへのねぎらい、ワンポイントアドバイスを250文字以内でまとめてください。

${context}`;

  return {
    prompt: systemPrompt,
    apiKey: apiKey
  };
}

function getSymptomPromptAndKey_(params) {
  const apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!apiKey) return { error: 'gemini_api_key_not_configured' };

  const familyId = params.familyId || DEFAULT_FAMILY_ID;
  const childId = params.childId || DEFAULT_CHILD_ID;
  
  // 過去のログや成長データを含む詳細な子供コンテキストを構築
  const context = buildPersonalContext(familyId, childId);

  const systemPrompt = `あなたは小児科救急のベテラン医師・ナースです。
提供された【この子供に関する最新のデータ】、およびユーザーが入力した「現在の体調・症状」をもとに、
緊急度を4段階（【緊急】今すぐ119番、【夜間救急】救急受診推奨、【翌日受診】翌日受診推奨、【自宅安静】自宅で様子見）で客観的・慎重に判定し、
親御さんへのアドバイスと観察すべきポイント、推奨アクション（#8000への電話、または小児科受診）をJSON形式のみで返答してください。

【注意】
必ず以下のJSONフォーマットのみを返してください。マークダウンの\`\`\`json等の囲みは不要です。
返却フォーマット:
{
  "urgency": "【緊急】今すぐ119番" / "【夜間救急】救急受診推奨" / "【翌日受診】翌日受診推奨" / "【自宅安静】自宅で様子見",
  "urgencyLevel": "danger" / "warning" / "info" / "success",
  "reason": "緊急度判定の簡潔な理由",
  "advice": "親御さんへの具体的アドバイスや看病の仕方",
  "points": ["観察ポイント1", "観察ポイント2", "観察ポイント3"],
  "action": "推奨する具体的な次の行動"
}

【この子供に関する最新のデータ】
${context}

【現在の体調・症状】
${params.symptom || '体調不良'}`;

  return {
    prompt: systemPrompt,
    apiKey: apiKey
  };
}

// ─── 認証・家族連携・編集 API ──────────────────────────────────────
function getOrCheckUser_(params) {
  let email = params && params.email;
  if (!email) {
    email = Session.getActiveUser().getEmail();
  }
  if (!email) {
    return { error: 'email_not_available', message: 'Googleアカウント情報が取得できません。' };
  }
  const users = getData('users');
  const user = users.find(u => String(u.email).toLowerCase() === email.toLowerCase());
  
  if (!user) {
    // 新規ユーザー登録
    const familyId = 'fam_' + Utilities.getUuid().substring(0, 8);
    const childId = 'child_' + Utilities.getUuid().substring(0, 8);
    
    const usersSheet = SS.getSheetByName('users');
    usersSheet.appendRow([email, familyId, 'admin']);
    
    SS.getSheetByName('families').appendRow([familyId, 'わが家']);
    SS.getSheetByName('children').appendRow([childId, familyId, 'お子さま', '']);
    
    // デフォルト設定
    const settingsSheet = SS.getSheetByName('settings');
    const defaults = [
      [familyId, 'feed_interval_hours', '3'],
      [familyId, 'sleep_interval_hours', '2'],
      [familyId, 'suggest_mode', 'average'],
      [familyId, 'milk_ml_suggestions', '100,120,140,160,200'],
      [familyId, 'sleep_min_suggestions', '30,60,90,120']
    ];
    defaults.forEach(r => settingsSheet.appendRow(r));
    
    return { email, familyId, childId, isNew: true };
  }
  
  // ユーザーが見つかった場合、家族に紐づく子供リストを取得
  const children = getChildrenFiltered({ familyId: user.family_id });
  const childId = children.length > 0 ? children[0].id : '';
  return { email, familyId: user.family_id, childId, isNew: false };
}

function getFamilyMembers_(params) {
  const familyId = params.familyId;
  if (!familyId) return [];
  const users = getData('users');
  return users.filter(u => u.family_id === familyId).map(u => ({ email: u.email, role: u.role }));
}

function addFamilyMember_(params) {
  const familyId = params.familyId;
  const emailToAdd = String(params.email).trim().toLowerCase();
  if (!familyId || !emailToAdd) return { error: 'invalid_params' };
  
  const sheet = SS.getSheetByName('users');
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase() === emailToAdd) {
      // すでに登録があれば家族IDを上書きして共有する
      sheet.getRange(i + 1, 2).setValue(familyId);
      sheet.getRange(i + 1, 3).setValue('member');
      return { status: 'success', updated: true };
    }
  }
  // 新規登録
  sheet.appendRow([emailToAdd, familyId, 'member']);
  return { status: 'success', updated: false };
}

function removeFamilyMember_(params) {
  const emailToRemove = String(params.email).trim().toLowerCase();
  if (!emailToRemove) return { error: 'invalid_params' };
  
  let myEmail = params.myEmail;
  if (!myEmail) {
    myEmail = Session.getActiveUser().getEmail();
  }
  if (myEmail && myEmail.toLowerCase() === emailToRemove) {
    return { error: 'cannot_remove_self', message: '自分自身を家族から外すことはできません。' };
  }
  
  const sheet = SS.getSheetByName('users');
  const rows = sheet.getDataRange().getValues();
  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]).toLowerCase() === emailToRemove) {
      // 家族から外し、独立した新しい家族IDを自動生成して割り当てる（完全に独立させる）
      const newFamilyId = 'fam_' + Utilities.getUuid().substring(0, 8);
      const newChildId = 'child_' + Utilities.getUuid().substring(0, 8);
      
      sheet.getRange(i + 1, 2).setValue(newFamilyId);
      sheet.getRange(i + 1, 3).setValue('admin');
      
      SS.getSheetByName('families').appendRow([newFamilyId, 'わが家']);
      SS.getSheetByName('children').appendRow([newChildId, newFamilyId, 'お子さま', '']);
      
      const settingsSheet = SS.getSheetByName('settings');
      const defaults = [
        [newFamilyId, 'feed_interval_hours', '3'],
        [newFamilyId, 'sleep_interval_hours', '2'],
        [newFamilyId, 'suggest_mode', 'average'],
        [newFamilyId, 'milk_ml_suggestions', '100,120,140,160,200'],
        [newFamilyId, 'sleep_min_suggestions', '30,60,90,120']
      ];
      defaults.forEach(r => settingsSheet.appendRow(r));
      
      return { status: 'success' };
    }
  }
  return { error: 'not_found' };
}

function updateFamily_(params) {
  const familyId = params.familyId;
  const name = params.name;
  if (!familyId || !name) return { error: 'invalid_params' };
  
  const sheet = SS.getSheetByName('families');
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === familyId) {
      sheet.getRange(i + 1, 2).setValue(name);
      return { status: 'success' };
    }
  }
  return { error: 'not_found' };
}

function deleteFamily_(params) {
  const familyId = params.familyId;
  if (!familyId) return { error: 'invalid_params' };
  
  if (familyId === DEFAULT_FAMILY_ID) {
    return { error: 'cannot_delete_default_family', message: 'デフォルトの家族は削除できません。' };
  }
  
  // 家族データを削除
  const fSheet = SS.getSheetByName('families');
  const fRows = fSheet.getDataRange().getValues();
  for (let i = fRows.length - 1; i >= 1; i--) {
    if (fRows[i][0] === familyId) {
      fSheet.deleteRow(i + 1);
    }
  }
  
  // 関連する子供も削除
  const cSheet = SS.getSheetByName('children');
  const cRows = cSheet.getDataRange().getValues();
  for (let i = cRows.length - 1; i >= 1; i--) {
    if (cRows[i][1] === familyId) {
      cSheet.deleteRow(i + 1);
    }
  }
  
  // ユーザーの所属家族をリセット（デフォルト家族へ移動）
  const uSheet = SS.getSheetByName('users');
  const uRows = uSheet.getDataRange().getValues();
  for (let i = 1; i < uRows.length; i++) {
    if (uRows[i][1] === familyId) {
      uSheet.getRange(i + 1, 2).setValue(DEFAULT_FAMILY_ID);
      uSheet.getRange(i + 1, 3).setValue('member');
    }
  }
  
  return { status: 'success' };
}

function updateChild_(params) {
  const childId = params.childId;
  const name = params.name;
  const birthDate = params.birthDate;
  if (!childId || !name) return { error: 'invalid_params' };
  
  const email = params && params.email;
  const myFamilyId = getUserFamilyId_(email);
  
  const sheet = SS.getSheetByName('children');
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === childId) {
      if (rows[i][1] !== myFamilyId) {
        return { error: 'unauthorized', message: 'この子どもの情報を編集する権限がありません。' };
      }
      sheet.getRange(i + 1, 3).setValue(name);
      sheet.getRange(i + 1, 4).setValue(birthDate || '');
      return { status: 'success' };
    }
  }
  return { error: 'not_found' };
}

function deleteChild_(params) {
  const childId = params.childId;
  if (!childId) return { error: 'invalid_params' };
  
  const email = params && params.email;
  const myFamilyId = getUserFamilyId_(email);
  
  const sheet = SS.getSheetByName('children');
  const rows = sheet.getDataRange().getValues();
  for (let i = rows.length - 1; i >= 1; i--) {
    if (rows[i][0] === childId) {
      if (rows[i][1] !== myFamilyId) {
        return { error: 'unauthorized', message: 'この子どもを削除する権限がありません。' };
      }
      sheet.deleteRow(i + 1);
      return { status: 'success' };
    }
  }
  return { error: 'not_found' };
}

function getUserFamilyId_(email) {
  if (!email) return DEFAULT_FAMILY_ID;
  const users = getData('users');
  const user = users.find(u => String(u.email).toLowerCase() === email.toLowerCase());
  return user ? user.family_id : DEFAULT_FAMILY_ID;
}

function getFamiliesFiltered_(params) {
  const email = params && params.email;
  const myFamilyId = getUserFamilyId_(email);
  const allFamilies = getData('families');
  return allFamilies.filter(f => f.id === myFamilyId);
}

// ─── 初期データ一括取得（高速化のため認証+家族+子供+設定を1回で返す） ─────
function getInitialData_(params) {
  try {
    // 1. ユーザー認証・登録
    const authResult = getOrCheckUser_(params);
    if (authResult.error) return authResult;

    const familyId = authResult.familyId;
    const email = authResult.email;

    // 2. 家族・子供・設定を並行取得（同一呼び出し内なので実質直列だが1往復で完結）
    const families = getFamiliesFiltered_({ email });
    const children = getChildrenFiltered({ familyId });
    const settings = getSettingsMap(familyId);
    const familyMembers = getFamilyMembers_({ familyId });

    // アクティブな子供IDを決定
    let childId = authResult.childId;
    if (!childId || !children.find(c => c.id === childId)) {
      childId = children.length > 0 ? children[0].id : '';
    }

    return {
      email,
      familyId,
      childId,
      isNew: authResult.isNew,
      families,
      children,
      settings,
      familyMembers
    };
  } catch (e) {
    logError_(e, 'getInitialData_');
    return { error: e.message };
  }
}
