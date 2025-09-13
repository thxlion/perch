  // Normalize media from twitterapi.io includes structure into a simple array
  function normalizeMediaFromIncludes(tweet, includes) {
    try {
      const att = tweet && tweet.attachments;
      if (!att) return [];
      const mediaKeys = att.media_keys || att.mediaKeys || [];
      if (!Array.isArray(mediaKeys) || mediaKeys.length === 0) return [];
      const includesMedia = includes && includes.media ? includes.media : [];
      if (!Array.isArray(includesMedia) || includesMedia.length === 0) return [];

      const out = [];
      mediaKeys.forEach((key) => {
        const m = includesMedia.find(x => x.media_key === key || x.mediaKey === key || x.key === key);
        if (!m) return;
        const type = m.type;
        if (type === 'photo' || type === 'image') {
          const url = m.url || m.preview_image_url || m.previewImageUrl || m.expanded_url || m.media_url_https || m.media_url;
          if (url) {
            out.push({ type: 'photo', media_url_https: url, media_url: url, url });
          }
        } else if (type === 'video' || type === 'animated_gif' || type === 'gif') {
          const variants = Array.isArray(m.variants) ? m.variants : [];
          out.push({ type: type === 'gif' ? 'animated_gif' : type, video_info: { variants: variants.map(v => ({ content_type: v.content_type || v.contentType, bitrate: v.bitrate, url: v.url })) } });
        }
      });
      return out;
    } catch (e) {
      console.warn('Failed to normalize media from includes:', e);
      return [];
    }
  }
// main.js - Tweet Link Saver logic

(function () {
  const STORAGE_KEY = 'tweetLinks';
  const API_KEY_STORAGE = 'twitterApiKey';
  const TWEETS_DATA_STORAGE = 'tweetsData';
  const MEDIA_CACHE_STORAGE = 'mediaCache';
  const CLOUD_STORAGE_KEY = 'perch_user_links';
  const API_BASE_URL = window.location.hostname === 'localhost' ? 'http://localhost:8001/api' : '/api';

  // DOM elements
  const input = document.getElementById('tweet-input');
  const saveBtn = document.getElementById('save-btn');
  const form = document.getElementById('tweet-form');
  const tweetsList = document.getElementById('tweets-list');
  const errorMsg = document.getElementById('error-msg');
  const infoMsg = document.getElementById('info-msg');
  const emptyMsg = document.getElementById('empty-msg');
  const tweetModal = document.getElementById('tweet-modal');
  const modalContent = document.getElementById('modal-content');
  const closeModal = document.getElementById('close-modal');
  
  // Settings elements
  const settingsBtn = document.getElementById('settings-btn');
  const settingsModal = document.getElementById('settings-modal');
  const closeSettings = document.getElementById('close-settings');
  const settingsApiKey = document.getElementById('settings-api-key');
  const toggleSettingsKey = document.getElementById('toggle-settings-key');
  const verifyApiKey = document.getElementById('verify-api-key');
  const testSync = document.getElementById('test-sync');
  const clearApiKey = document.getElementById('clear-api-key');
  const apiKeyStatus = document.getElementById('api-key-status');
  const apiKeyStatusContent = document.getElementById('api-key-status-content');
  const syncStatus = document.getElementById('sync-status');
  const syncStatusContent = document.getElementById('sync-status-content');
  const toastContainer = document.getElementById('toast-container');


  // IndexedDB media caching functions
  let mediaDB = null;

  async function initMediaDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('TweetMediaCache', 1);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        mediaDB = request.result;
        resolve(mediaDB);
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('media')) {
          const store = db.createObjectStore('media', { keyPath: 'id' });
          store.createIndex('cached', 'cached', { unique: false });
        }
      };
    });
  }

  async function loadMediaFromDB(mediaId) {
    if (!mediaDB) await initMediaDB();
    
    return new Promise((resolve, reject) => {
      const transaction = mediaDB.transaction(['media'], 'readonly');
      const store = transaction.objectStore('media');
      const request = store.get(mediaId);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async function saveMediaToDB(mediaId, url, blob) {
    if (!mediaDB) await initMediaDB();
    
    return new Promise((resolve, reject) => {
      const transaction = mediaDB.transaction(['media'], 'readwrite');
      const store = transaction.objectStore('media');
      
      const mediaData = {
        id: mediaId,
        url: url,
        blob: blob,
        type: blob.type,
        size: blob.size,
        cached: Date.now()
      };
      
      const request = store.put(mediaData);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(mediaData);
    });
  }

  async function downloadAndCacheMedia(url, mediaId, isVideo = false) {
    try {
      console.log('Downloading media:', url, `(${isVideo ? 'video' : 'image'})`);
      
      // Check if already cached
      const cached = await loadMediaFromDB(mediaId);
      if (cached) {
        console.log('Media already cached:', mediaId);
        return URL.createObjectURL(cached.blob);
      }
      
      // Use proxy server to handle CORS
      const proxyUrl = `${API_BASE_URL}/fetch?url=${encodeURIComponent(url)}`;
      const response = await fetch(proxyUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const blob = await response.blob();
      console.log('Downloaded media:', mediaId, `(${(blob.size / 1024 / 1024).toFixed(2)} MB)`);
      
      // Save to IndexedDB (no size limits)
      await saveMediaToDB(mediaId, url, blob);
      console.log('Media cached in IndexedDB:', mediaId);
      
      // Return blob URL for immediate use
      return URL.createObjectURL(blob);
      
    } catch (error) {
      console.error('Failed to cache media:', url, error);
      // Return proxy URL as fallback
      return `${API_BASE_URL}/fetch?url=${encodeURIComponent(url)}`;
    }
  }

  async function getCachedMediaUrl(mediaId, originalUrl) {
    try {
      const cached = await loadMediaFromDB(mediaId);
      if (cached) {
        console.log('Using cached media from IndexedDB:', mediaId);
        return URL.createObjectURL(cached.blob);
      }
    } catch (error) {
      console.error('Error loading cached media:', error);
    }
    return originalUrl;
  }

  // Real cloud storage functions using JSONBin.io
  function getCloudStorageKey(apiKey) {
    // Create a unique key based on API key hash
    return `perch_${btoa(apiKey).slice(0, 16)}`;
  }

  async function saveLinksToCloud(apiKey, links) {
    try {
      console.log('Attempting to save links to JSONBin.io...');
      // Try JSONBin.io first (real cloud storage)
      const response = await fetch('https://api.jsonbin.io/v3/b', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': '$2a$10$5on.HVf8etgJRAH3Z5kAvONjpXPhz.yXmixJBPGkjBLkgo90dnOKy',
          'X-Bin-Name': getCloudStorageKey(apiKey)
        },
        body: JSON.stringify({
          apiKey: btoa(apiKey),
          links: links,
          lastUpdated: Date.now()
        })
      });

      if (response.ok) {
        const result = await response.json();
        localStorage.setItem(`${CLOUD_STORAGE_KEY}_binId`, result.metadata.id);
        console.log('✅ Links saved to JSONBin cloud storage:', result.metadata.id);
        return true;
      } else {
        const errorText = await response.text();
        console.error('❌ JSONBin API Error:', response.status, response.statusText, errorText);
        throw new Error(`JSONBin error: ${response.status} - ${errorText}`);
      }
    } catch (error) {
      console.error('❌ JSONBin failed:', error.message);
      console.warn('🔄 Using localStorage fallback...');
      // Fallback to localStorage
      const cloudKey = getCloudStorageKey(apiKey);
      const cloudData = {
        apiKey: btoa(apiKey),
        links: links,
        lastUpdated: Date.now()
      };
      localStorage.setItem(cloudKey, JSON.stringify(cloudData));
      console.log('✅ Links saved to localStorage fallback');
      return true;
    }
  }

  async function loadLinksFromCloud(apiKey) {
    try {
      console.log('🔍 Attempting to load links from JSONBin.io...');
      // Try JSONBin.io first
      const binId = localStorage.getItem(`${CLOUD_STORAGE_KEY}_binId`);
      console.log('🆔 Stored bin ID:', binId);
      
      if (binId) {
        console.log('📡 Fetching from JSONBin with ID:', binId);
        const response = await fetch(`https://api.jsonbin.io/v3/b/${binId}`, {
          headers: {
            'X-Master-Key': '$2a$10$5on.HVf8etgJRAH3Z5kAvONjpXPhz.yXmixJBPGkjBLkgo90dnOKy'
          }
        });

        console.log('📥 JSONBin response status:', response.status);
        
        if (response.ok) {
          const result = await response.json();
          console.log('📄 JSONBin response data:', result);
          
          if (result.record && result.record.apiKey === btoa(apiKey)) {
            console.log('✅ API key matches, returning links:', result.record.links);
            return result.record.links || [];
          } else {
            console.log('❌ API key mismatch. Expected:', btoa(apiKey), 'Got:', result.record?.apiKey);
          }
        } else {
          const errorText = await response.text();
          console.error('❌ JSONBin load error:', response.status, errorText);
        }
      } else {
        console.log('🔍 No bin ID found, checking localStorage fallback...');
      }
    } catch (error) {
      console.error('❌ JSONBin failed:', error.message);
      console.warn('🔄 Trying localStorage fallback...');
    }

    // Fallback to localStorage
    try {
      const cloudKey = getCloudStorageKey(apiKey);
      console.log('🔑 Checking localStorage with key:', cloudKey);
      const stored = localStorage.getItem(cloudKey);
      console.log('💾 localStorage data:', stored);
      
      if (stored) {
        const cloudData = JSON.parse(stored);
        console.log('📋 Parsed cloud data:', cloudData);
        
        if (cloudData.apiKey === btoa(apiKey)) {
          console.log('✅ Links loaded from localStorage fallback:', cloudData.links);
          return cloudData.links || [];
        } else {
          console.log('❌ localStorage API key mismatch');
        }
      } else {
        console.log('📭 No localStorage data found');
      }
    } catch (error) {
      console.error('❌ Failed to load links from storage:', error);
    }
    
    console.log('🚫 No links found in any storage');
    return null;
  }

  async function updateCloudLinks(apiKey, links) {
    const binId = localStorage.getItem(`${CLOUD_STORAGE_KEY}_binId`);
    if (!binId) {
      return await saveLinksToCloud(apiKey, links);
    }

    try {
      console.log('Updating JSONBin with bin ID:', binId);
      const response = await fetch(`https://api.jsonbin.io/v3/b/${binId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': '$2a$10$5on.HVf8etgJRAH3Z5kAvONjpXPhz.yXmixJBPGkjBLkgo90dnOKy'
        },
        body: JSON.stringify({
          apiKey: btoa(apiKey),
          links: links,
          lastUpdated: Date.now()
        })
      });

      if (response.ok) {
        console.log('✅ Links updated in JSONBin cloud storage');
        return true;
      } else {
        const errorText = await response.text();
        console.error('❌ JSONBin update error:', response.status, errorText);
        throw new Error(`Update failed: ${response.status} - ${errorText}`);
      }
    } catch (error) {
      console.error('❌ JSONBin update failed:', error.message);
      console.warn('🔄 Using localStorage fallback...');
    }

    // Fallback to localStorage
    return await saveLinksToCloud(apiKey, links);
  }

  async function syncLinksWithCloud(apiKey) {
    if (!apiKey) return;

    showToast('Syncing your saved links...', 'info');
    
    try {
      console.log('🔄 Starting sync process...');
      const cloudLinks = await loadLinksFromCloud(apiKey);
      console.log('☁️ Cloud links found:', cloudLinks);
      
      if (cloudLinks && cloudLinks.length > 0) {
        console.log('✅ Found cloud links, merging...');
        // Merge cloud links with local links
        const localLinks = loadLinks();
        console.log('📱 Local links:', localLinks);
        
        const mergedLinks = [...cloudLinks];
        
        // Add any local links that aren't in cloud
        localLinks.forEach(localLink => {
          const exists = cloudLinks.some(cloudLink => 
            normalizeUrl(cloudLink.url || cloudLink) === normalizeUrl(localLink.url || localLink)
          );
          if (!exists) {
            mergedLinks.push(localLink);
          }
        });

        console.log('🔗 Merged links:', mergedLinks);
        
        // Save merged links locally
        saveLinks(mergedLinks);
        console.log('💾 Saved merged links locally');
        
        // Pre-fetch and cache tweet data for all links
        await prefetchAllTweets(mergedLinks, apiKey);
        
        console.log('🎨 Rendering tweets...');
        renderTweets(loadLinks());
        showToast(`Synced ${cloudLinks.length} saved links from cloud`, 'success');
      } else {
        console.log('❌ No cloud links found, uploading local links...');
        // No cloud links found, upload current local links
        const localLinks = loadLinks();
        console.log('📱 Local links to upload:', localLinks);
        
        if (localLinks.length > 0) {
          await saveLinksToCloud(apiKey, localLinks);
          showToast('Uploaded local links to cloud', 'success');
        } else {
          console.log('📭 No local links to upload');
          showToast('No links to sync', 'info');
        }
      }
    } catch (error) {
      console.error('❌ Sync failed:', error);
      console.error('Error details:', error.message, error.stack);
      showToast('Failed to sync with cloud storage: ' + error.message, 'error');
    }
  }

  async function saveTweetWithData(url, apiKey) {
    const tweetId = extractTweetId(url);
    if (!tweetId) {
      throw new Error('Invalid tweet URL');
    }

    const links = loadLinks();
    
    // Check for duplicates with normalized URLs
    const normalizedUrl = normalizeTwitterUrl(url);
    const existingLink = links.find(link => normalizeTwitterUrl(link.url) === normalizedUrl);
    if (existingLink) {
      throw new Error('Link already saved');
    }

    // Fetch tweet data
    const tweetData = await fetchTweetData(tweetId, apiKey);
    if (!tweetData) {
      throw new Error('Failed to fetch tweet data');
    }

    // Save tweet data
    saveTweetData(tweetId, tweetData);

    // Add to links
    const newLink = {
      url: normalizedUrl,
      id: tweetId,
      saved: Date.now()
    };
    links.push(newLink);
    saveLinks(links);

    // Update cloud storage
    updateCloudLinks(apiKey, links);

    return newLink;
  }

  async function prefetchAllTweets(links, apiKey) {
    let processed = 0;
    const total = links.length;
    
    for (const link of links) {
      try {
        const tweetId = extractTweetId(link.url);
        if (tweetId) {
          const existingData = loadTweetData(tweetId);
          if (!existingData) {
            const tweetData = await fetchTweetData(tweetId, apiKey);
            if (tweetData) {
              saveTweetData(tweetId, tweetData);
            }
          }
        }
        processed++;
        if (processed % 5 === 0) {
          showToast(`Caching tweets... ${processed}/${total}`, 'info');
        }
      } catch (error) {
        console.error('Failed to prefetch tweet:', link.url, error);
      }
    }
    
    if (total > 0) {
      showToast(`Cached ${processed} tweets for offline reading`, 'success');
    }
  }

  // Initialize IndexedDB and sync on page load
  document.addEventListener('DOMContentLoaded', async () => {
    initMediaDB().catch(console.error);
    
    // Auto-sync if API key exists
    const existingApiKey = localStorage.getItem(API_KEY_STORAGE);
    if (existingApiKey) {
      await syncLinksWithCloud(existingApiKey);
    }
  });

  // Helpers
  function loadLinks() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (Array.isArray(stored)) {
        return stored;
      }
    } catch (e) {
      console.error('Failed parsing stored links', e);
    }
    return [];
  }

  function saveLinks(arr) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  }

  function loadTweetsData() {
    try {
      const stored = JSON.parse(localStorage.getItem(TWEETS_DATA_STORAGE));
      return stored || {};
    } catch (e) {
      console.error('Failed parsing stored tweets data', e);
    }
    return {};
  }

  function saveTweetsData(data) {
    localStorage.setItem(TWEETS_DATA_STORAGE, JSON.stringify(data));
  }

  function loadApiKey() {
    return localStorage.getItem(API_KEY_STORAGE) || '';
  }

  function saveApiKey(key) {
    localStorage.setItem(API_KEY_STORAGE, key);
  }

  function isValidTweetUrl(str) {
    try {
      const url = new URL(str.trim());
      const hosts = ['twitter.com', 'www.twitter.com', 'x.com', 'www.x.com'];
      if (!hosts.includes(url.hostname)) return false;
      // Path must include /status/
      return /\/status\//.test(url.pathname);
    } catch (e) {
      return false;
    }
  }

  function extractTweetId(url) {
    try {
      const urlObj = new URL(url.trim());
      const match = urlObj.pathname.match(/\/status\/(\d+)/);
      return match ? match[1] : null;
    } catch (e) {
      return null;
    }
  }

  async function fetchTweetData(tweetId, apiKey) {
    try {
      const response = await fetch(`${API_BASE_URL}/twitter/tweets?tweet_ids=${tweetId}&expansions=attachments.media_keys&media.fields=type,url,preview_image_url,variants,width,height,alt_text`, {
        method: 'GET',
        headers: {
          'X-API-Key': apiKey
        }
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText} - ${JSON.stringify(data)}`);
      }
      
      if (data.tweets && data.tweets.length > 0) {
        const tweet = data.tweets[0];
        // Attach normalized media array if includes are present
        const includes = data.includes || data._includes || null;
        if (includes) {
          const norm = normalizeMediaFromIncludes(tweet, includes);
          if (norm && norm.length) {
            tweet._media = norm;
          }
        }
        return { data: tweet, includes: data.includes || null };
      } else {
        throw new Error('No tweet data found in response');
      }
    } catch (error) {
      console.error('Error fetching tweet:', error);
      throw error;
    }
  }
  
  async function fetchOembedData(tweetUrl) {
    try {
      // Use Twitter's oEmbed API to get rich media
      const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(tweetUrl)}&omit_script=true&dnt=true`;
      const response = await fetch(`${API_BASE_URL}?url=${encodeURIComponent(oembedUrl)}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch oEmbed data');
      }
      
      return await response.json();
    } catch (error) {
      console.error('Error fetching oEmbed:', error);
      return null;
    }
  }

  async function verifyApiKeyFunction(apiKey) {
    try {
      // Use TwitterAPI.io endpoint to verify the TwitterAPI.io key
      const response = await fetch(`${API_BASE_URL}/twitter/tweets?tweet_ids=1234567890123456789`, {
        headers: {
          'X-API-Key': apiKey,
          'Content-Type': 'application/json'
        }
      });

      console.log('API verification response:', response.status, response.statusText);
      
      if (response.status === 401 || response.status === 403) {
        return { valid: false, message: 'Invalid TwitterAPI.io API key' };
      }
      
      // Accept any non-auth error as valid key (network issues, invalid tweet ID, etc.)
      if (response.status !== 401 && response.status !== 403) {
        return { 
          valid: true, 
          accountType: 'TwitterAPI.io'
        };
      }
      
      return { valid: false, message: `Unexpected response: ${response.status}` };
    } catch (error) {
      console.error('API verification error:', error);
      return { valid: false, message: error.message };
      // Network errors or other issues
      return { valid: false, message: `Verification failed: ${error.message}` };
    }
  }

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    const bgColor = type === 'success' ? 'bg-green-500' : type === 'error' ? 'bg-red-500' : 'bg-blue-500';
    
    toast.className = `${bgColor} text-white px-4 py-3 rounded-lg shadow-lg transform transition-all duration-300 translate-x-full opacity-0`;
    toast.textContent = message;
    
    toastContainer.appendChild(toast);
    
    // Trigger animation
    setTimeout(() => {
      toast.classList.remove('translate-x-full', 'opacity-0');
    }, 100);
    
    // Remove toast after 4 seconds
    setTimeout(() => {
      toast.classList.add('translate-x-full', 'opacity-0');
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    }, 4000);
  }

  function renderTweets(links) {
    const tweetsData = loadTweetsData();
    
    console.log('=== RENDER TWEETS DEBUG ===');
    console.log('Links to render:', links);
    console.log('Tweets data:', tweetsData);
    
    // Clear list
    tweetsList.innerHTML = '';

    // Handle case where links is undefined or not an array
    if (!links || !Array.isArray(links) || !links.length) {
      emptyMsg.classList.remove('hidden');
      return;
    }
    emptyMsg.classList.add('hidden');

    links.forEach((link, index) => {
      const tweetId = extractTweetId(link);
      const tweetData = tweetsData[tweetId];
      
      console.log(`Rendering tweet ${index}: ID=${tweetId}, Data exists=${!!tweetData}`);
      if (tweetData) {
        console.log('Tweet data:', tweetData);
      } else {
        console.log('No tweet data found for ID:', tweetId);
      }
      
      const tweetCard = document.createElement('div');
      tweetCard.className = 'border rounded-lg p-4 bg-white hover:shadow-md transition-shadow cursor-pointer';
      
      if (tweetData && tweetData.data) {
        const tweet = tweetData.data;
        const author = tweet.author || {};
        
        tweetCard.innerHTML = `
          <div class="flex items-start space-x-3">
            <div class="flex-shrink-0">
              ${author.profilePicture ? 
                `<img src="${author.profilePicture}" alt="${author.name || 'User'}" class="w-12 h-12 rounded-full object-cover" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                 <div class="w-12 h-12 bg-gray-300 rounded-full flex items-center justify-center" style="display:none;">
                   <span class="text-gray-600 font-semibold">${(author.name || 'U')[0].toUpperCase()}</span>
                 </div>` :
                `<div class="w-12 h-12 bg-gray-300 rounded-full flex items-center justify-center">
                   <span class="text-gray-600 font-semibold">${(author.name || 'U')[0].toUpperCase()}</span>
                 </div>`
              }
            </div>
            <div class="flex-grow min-w-0">
              <div class="flex items-center space-x-2 mb-1">
                <h3 class="font-semibold text-gray-900 truncate">${author.name || 'Unknown User'}</h3>
                <span class="text-gray-500 text-sm">@${author.userName || 'unknown'}</span>
                <span class="text-gray-400 text-sm">•</span>
                <span class="text-gray-500 text-sm">${formatDate(tweet.createdAt)}</span>
              </div>
              <p class="text-gray-800 mb-2 line-clamp-3">${tweet.text || 'No text available'}</p>
              <div class="tweet-media-container">${renderTweetMedia(tweet)}</div>
            </div>
            <div class="flex-shrink-0">
              <button class="more-btn text-gray-500 hover:text-gray-700 p-1" data-index="${index}" aria-label="More options">
                <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z"></path>
                </svg>
              </button>
            </div>
          </div>
        `;
      } else {
        // Try to fetch the tweet data if it's missing
        console.log('Attempting to fetch missing tweet data for ID:', tweetId);
        const apiKey = loadApiKey();
        if (apiKey) {
          fetchTweetData(tweetId, apiKey).then(result => {
            if (result && result.data) {
              const tweetsData = loadTweetsData();
              tweetsData[tweetId] = result;
              saveTweetsData(tweetsData);
              console.log('Successfully fetched and saved tweet data for ID:', tweetId);
              renderTweets(loadLinks()); // Re-render with new data
            }
          }).catch(error => {
            console.error('Failed to fetch tweet data for ID:', tweetId, error);
          });
        }
        
        // Show placeholder for missing tweet data
        tweetCard.innerHTML = `
          <div class="flex items-start space-x-3">
            <div class="flex-shrink-0">
              <div class="w-12 h-12 bg-gray-300 rounded-full"></div>
            </div>
            <div class="flex-grow">
              <div class="flex items-center justify-between">
                <div class="text-sm text-gray-500">Loading tweet data...</div>
                <button class="more-btn p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
                  <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z"></path>
                  <div class="h-4 bg-gray-200 rounded w-32 mb-1 animate-pulse"></div>
                  <div class="h-3 bg-gray-200 rounded w-24 animate-pulse"></div>
                </div>
                <button class="delete-btn text-red-600 hover:text-red-800 p-1" data-index="${index}" aria-label="Delete tweet">
                  <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"></path>
                  </svg>
                </button>
              </div>
              <p class="text-sm text-gray-500 mt-2">${tweetData?.error ? 'Failed to load tweet data' : 'Loading tweet data...'}</p>
              <p class="text-xs text-blue-600 break-all">${link}</p>
            </div>
          </div>
        `;
      }

      // Add click handler for viewing full tweet
      tweetCard.addEventListener('click', (e) => {
        if (!e.target.closest('.more-btn')) {
          showTweetModal(tweetData, link);
        }
      });

      // Add more options handler
      const moreBtn = tweetCard.querySelector('.more-btn');
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showMoreOptions(index, tweetId, links);
      });

      tweetsList.appendChild(tweetCard);
    });
  }

  function renderTweetMedia(tweet) {
    console.log('=== MEDIA EXTRACTION DEBUG ===');
    console.log('Full tweet object:', tweet);
    console.log('Tweet keys:', Object.keys(tweet || {}));
    
    // Check all possible media locations in the API response
    const locations = [
      { name: 'tweet._media', data: tweet && tweet._media },
      { name: 'tweet.extended_entities.media', data: tweet && tweet.extended_entities && tweet.extended_entities.media },
      { name: 'tweet.entities.media', data: tweet && tweet.entities && tweet.entities.media },
      { name: 'tweet.attachments', data: tweet && tweet.attachments },
      { name: 'tweet.media', data: tweet && tweet.media }
    ];
    
    locations.forEach(loc => {
      if (loc.data) {
        console.log(`Found ${loc.name}:`, loc.data);
      }
    });
    
    // Specifically check extendedEntities since it appears in the API response
    if (tweet.extendedEntities) {
      console.log('extendedEntities found:', tweet.extendedEntities);
      if (tweet.extendedEntities.media) {
        console.log('extendedEntities.media:', tweet.extendedEntities.media);
      }
    }
    
    // Try to extract media from the most likely locations
    const media = tweet && (tweet._media || (tweet.extendedEntities && tweet.extendedEntities.media) || (tweet.extended_entities && tweet.extended_entities.media) || (tweet.entities && tweet.entities.media));
    
    if (Array.isArray(media) && media.length) {
      console.log('Rendering direct media:', media);
      let html = '<div class="mt-2 space-y-2">';
      media.forEach((item, index) => {
        console.log(`Processing media item ${index}:`, item);
        console.log('Item type:', item.type);
        console.log('All item keys:', Object.keys(item));
        
        if (item.type === 'photo' || item.type === 'image') {
          const imageUrl = item.media_url_https || item.media_url || item.url || item.src;
          console.log('Photo URL found:', imageUrl);
          if (imageUrl) {
            const mediaId = item.id_str || item.media_key || `img_${Date.now()}_${Math.random()}`;
            
            // Check if already cached first
            getCachedMediaUrl(mediaId, imageUrl).then(cachedUrl => {
              const imgElement = document.querySelector(`img[data-media-id="${mediaId}"]`);
              if (imgElement) {
                imgElement.src = cachedUrl;
                if (cachedUrl === imageUrl) {
                  // Not cached yet, start download
                  downloadAndCacheMedia(imageUrl, mediaId, false).then(newCachedUrl => {
                    if (newCachedUrl !== imageUrl) {
                      imgElement.src = newCachedUrl;
                    }
                  });
                }
              }
            });
            
            html += `
              <div>
                <img src="${imageUrl}" alt="Tweet image" class="rounded-lg max-w-full h-auto border" style="max-height: 300px;" loading="lazy" data-media-id="${mediaId}">
              </div>
            `;
          }
        } else if (item.type === 'video' || item.type === 'animated_gif') {
          console.log('Processing video item:', item);
          console.log('Video info:', item.video_info);
          console.log('Item keys:', Object.keys(item));
          
          let best = null;
          
          // Check video_info.variants first
          const variants = item.video_info && Array.isArray(item.video_info.variants) ? item.video_info.variants : [];
          console.log('Video variants found:', variants);
          
          if (variants.length > 0) {
            const mp4s = variants.filter(v => (v.content_type || '').includes('mp4'));
            console.log('MP4 variants:', mp4s);
            
            if (mp4s.length) {
              mp4s.sort((a,b)=> (b.bitrate||0)-(a.bitrate||0));
              best = mp4s[0].url;
            }
          }
          
          // Fallback to other URL fields
          if (!best && item.media_url_https) best = item.media_url_https;
          if (!best && item.media_url) best = item.media_url;
          if (!best && item.url) best = item.url;
          
          // Check if there's a preview image we can show with a play button
          const previewUrl = item.media_url_https || item.media_url;
          
          console.log('Final video URL:', best);
          console.log('Preview image URL:', previewUrl);
          
          if (best) {
            const mediaId = item.id_str || item.media_key || `vid_${Date.now()}_${Math.random()}`;
            
            const controls = item.type === 'video' ? 'controls' : 'autoplay muted loop';
            html += `
              <div class="relative">
                <video ${controls} class="rounded-lg max-w-full h-auto border" style="max-height: 300px;" preload="metadata" data-media-id="${mediaId}">
                  <source src="" type="video/mp4">
                  Your browser does not support the video tag.
                </video>
              </div>
            `;
            
            // Check if already cached, otherwise use proxy and cache
            getCachedMediaUrl(mediaId, best).then(cachedUrl => {
              console.log('Setting video source:', mediaId, cachedUrl);
              const videoElement = document.querySelector(`video[data-media-id="${mediaId}"]`);
              if (videoElement) {
                const sourceElement = videoElement.querySelector('source');
                if (sourceElement) {
                  if (cachedUrl === best) {
                    // Not cached, use proxy URL and start caching
                    const proxyVideoUrl = `${API_BASE_URL}/fetch?url=${encodeURIComponent(best)}`;
                    sourceElement.src = proxyVideoUrl;
                    videoElement.load();
                    console.log('Using proxy URL for video:', proxyVideoUrl);
                    
                    // Cache in background
                    downloadAndCacheMedia(best, mediaId, true).then(newCachedUrl => {
                      if (newCachedUrl !== best && newCachedUrl !== proxyVideoUrl) {
                        console.log('Video cached, updating to blob URL:', mediaId);
                        sourceElement.src = newCachedUrl;
                        videoElement.load();
                      }
                    }).catch(error => {
                      console.error('Error caching video:', error);
                    });
                  } else {
                    // Already cached, use blob URL
                    console.log('Using cached video:', mediaId);
                    sourceElement.src = cachedUrl;
                    videoElement.load();
                  }
                }
              }
            });
          } else if (previewUrl) {
            const mediaId = item.id_str || item.media_key || `prev_${Date.now()}_${Math.random()}`;
            
            html += `
              <div class="relative">
                <img src="${previewUrl}" alt="Video preview" class="rounded-lg max-w-full h-auto border" style="max-height: 300px;" loading="lazy" data-media-id="${mediaId}">
                <div class="absolute inset-0 flex items-center justify-center">
                  <div class="bg-black bg-opacity-50 rounded-full p-3">
                    <svg class="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.841z"/>
                    </svg>
                  </div>
                </div>
              </div>
            `;
            
            // Cache the preview image asynchronously
            downloadAndCacheMedia(previewUrl, mediaId, false).then(cachedUrl => {
              const imgElement = document.querySelector(`img[data-media-id="${mediaId}"]`);
              if (imgElement) {
                imgElement.src = cachedUrl;
              }
            });
          } else {
            console.warn('No video URL or preview found for item:', item);
          }
        }
      });
      html += '</div>';
      console.log('=== MEDIA DEBUG END ===');
      return html;
    }
    
    console.log('No direct media found, checking for pic.twitter.com links in text');
    // Check if there are pic.twitter.com links in the text as indicator
    const picTwitterMatch = tweet && tweet.text ? tweet.text.match(/pic\.twitter\.com\/\w+/g) : null;
    if (picTwitterMatch) {
      console.log('Found pic.twitter.com links:', picTwitterMatch);
      return `
        <div class="mt-2 text-xs text-gray-500">
          <div class="p-2 bg-gray-50 border border-gray-200 rounded">
            📷 Tweet contains media (${picTwitterMatch.length} item${picTwitterMatch.length > 1 ? 's' : ''}) - API doesn't provide direct URLs
          </div>
        </div>
      `;
    }
    
    console.log('=== MEDIA DEBUG END ===');
    return '';
  }

  function renderTweetMediaModal(tweet) {
    // Use the same logic as renderTweetMedia but for modal (full size)
    const media = tweet && (tweet._media || (tweet.extendedEntities && tweet.extendedEntities.media) || (tweet.extended_entities && tweet.extended_entities.media) || (tweet.entities && tweet.entities.media));
    
    if (Array.isArray(media) && media.length) {
      let html = '<div class="mt-4 space-y-3">';
      media.forEach((item, index) => {
        if (item.type === 'photo' || item.type === 'image') {
          const imageUrl = item.media_url_https || item.media_url || item.url || item.src;
          if (imageUrl) {
            html += `
              <div>
                <img src="${imageUrl}" alt="Tweet image" class="rounded-lg max-w-full h-auto border" loading="lazy">
              </div>
            `;
          }
        } else if (item.type === 'video' || item.type === 'animated_gif') {
          let best = null;
          const variants = item.video_info && Array.isArray(item.video_info.variants) ? item.video_info.variants : [];
          const mp4s = variants.filter(v => (v.content_type || '').includes('mp4'));
          if (mp4s.length) {
            mp4s.sort((a,b)=> (b.bitrate||0)-(a.bitrate||0));
            best = mp4s[0].url;
          }
          if (!best && item.url) best = item.url;
          if (best) {
            const controls = item.type === 'video' ? 'controls' : 'autoplay muted loop';
            html += `
              <div>
                <video ${controls} class="rounded-lg max-w-full h-auto border">
                  <source src="${best}" type="video/mp4">
                </video>
              </div>
            `;
          }
        }
      });
      html += '</div>';
      return html;
    }
    
    return '';
  }

  function formatDate(dateString) {
    if (!dateString) return 'Unknown date';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric',
        year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
      });
    } catch (e) {
      return 'Unknown date';
    }
  }

  function showTweetModal(tweetData, originalUrl) {
    if (!tweetData || !tweetData.data) {
      modalContent.innerHTML = `
        <div class="text-center py-8">
          <p class="text-gray-500 mb-4">Tweet data not available</p>
          <a href="${originalUrl}" target="_blank" class="text-blue-600 hover:underline">View on Twitter/X</a>
        </div>
      `;
    } else {
      const tweet = tweetData.data;
      const author = tweet.author || {};
      
      modalContent.innerHTML = `
        <div class="space-y-4">
          <div class="flex items-start space-x-3">
            <div class="flex-shrink-0">
              ${author.profilePicture ? 
                `<img src="${author.profilePicture}" alt="${author.name || 'User'}" class="w-16 h-16 rounded-full object-cover" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                 <div class="w-16 h-16 bg-gray-300 rounded-full flex items-center justify-center" style="display:none;">
                   <span class="text-gray-600 font-semibold text-xl">${(author.name || 'U')[0].toUpperCase()}</span>
                 </div>` :
                `<div class="w-16 h-16 bg-gray-300 rounded-full flex items-center justify-center">
                   <span class="text-gray-600 font-semibold text-xl">${(author.name || 'U')[0].toUpperCase()}</span>
                 </div>`
              }
            </div>
            <div class="flex-grow">
              <div class="flex items-center space-x-2 mb-2">
                <h3 class="font-bold text-lg text-gray-900">${author.name || 'Unknown User'}</h3>
                <span class="text-gray-500">@${author.userName || 'unknown'}</span>
                ${author.verified ? '<span class="text-blue-500">✓</span>' : ''}
              </div>
            </div>
          </div>
          
          <div class="border-t pt-4">
            <p class="text-gray-900 text-lg leading-relaxed whitespace-pre-wrap">${tweet.text || 'No text available'}</p>
            ${renderTweetMediaModal(tweet)}
          </div>
          
          <div class="border-t pt-4">
            <div class="flex items-center justify-between text-sm text-gray-500 mb-3">
              <span>${formatFullDate(tweet.createdAt)}</span>
            </div>
          </div>
          
          <div class="border-t pt-4">
            <a href="${originalUrl}" target="_blank" class="text-blue-600 hover:underline text-sm">View original on Twitter/X →</a>
          </div>
        </div>
      `;
    }
    
    tweetModal.classList.remove('hidden');
  }

  function showMoreOptions(index, tweetId, links) {
    // Create a proper dropdown menu
    const existingDropdown = document.querySelector('.more-options-dropdown');
    if (existingDropdown) {
      existingDropdown.remove();
    }

    const dropdown = document.createElement('div');
    dropdown.className = 'more-options-dropdown absolute right-0 top-8 bg-white border border-gray-200 rounded-lg shadow-lg z-10 min-w-32';
    dropdown.innerHTML = `
      <button class="delete-option w-full text-left px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg flex items-center space-x-2">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
        </svg>
        <span>Delete</span>
      </button>
    `;

    // Position dropdown relative to the more button
    const moreBtn = event.target.closest('.more-btn');
    const moreBtnContainer = moreBtn.parentElement;
    moreBtnContainer.style.position = 'relative';
    moreBtnContainer.appendChild(dropdown);

    // Handle delete click
    dropdown.querySelector('.delete-option').addEventListener('click', () => {
      dropdown.remove();
      const confirmDelete = confirm('Delete this tweet?');
      if (confirmDelete) {
        links.splice(index, 1);
        saveLinks(links);
        
        // Also remove from tweets data
        if (tweetId) {
          const tweetsData = loadTweetsData();
          delete tweetsData[tweetId];
          saveTweetsData(tweetsData);
        }
        
        renderTweets(links);
        showToast('Tweet deleted successfully', 'success');
      }
    });

    // Close dropdown when clicking outside
    setTimeout(() => {
      document.addEventListener('click', function closeDropdown(e) {
        if (!dropdown.contains(e.target)) {
          dropdown.remove();
          document.removeEventListener('click', closeDropdown);
        }
      });
    }, 0);
  }

  function formatFullDate(dateString) {
    if (!dateString) return 'Unknown date';
    try {
      const date = new Date(dateString);
      return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    } catch (e) {
      return 'Unknown date';
    }
  }

  function showMessage(el, text) {
    el.textContent = text;
    el.classList.remove('hidden');
    // auto-hide after 3s
    setTimeout(() => {
      el.classList.add('hidden');
    }, 3000);
  }

  function clearMessages() {
    errorMsg.classList.add('hidden');
    infoMsg.classList.add('hidden');
  }

  async function saveTweetWithData(url) {
    const links = loadLinks();
    
    // Normalize URL for comparison (handle x.com vs twitter.com)
    const normalizeUrl = (u) => {
      return u.replace('://x.com/', '://twitter.com/').replace('://www.x.com/', '://twitter.com/').replace('://www.twitter.com/', '://twitter.com/');
    };
    
    const normalizedUrl = normalizeUrl(url);
    const existingNormalizedUrls = links.map(normalizeUrl);
    
    if (existingNormalizedUrls.includes(normalizedUrl)) {
      showMessage(infoMsg, 'This link is already saved.');
      return;
    }

    // Add to links immediately
    links.push(url);
    saveLinks(links);
    renderTweets(links);

    // Try to fetch tweet data
    const apiKey = loadApiKey();
    const tweetId = extractTweetId(url);
    
    if (!apiKey) {
      showMessage(errorMsg, 'Please enter your TwitterAPI.io API key to fetch tweet data.');
      return;
    }

    if (!tweetId) {
      showMessage(errorMsg, 'Could not extract tweet ID from URL.');
      return;
    }

    try {
      const tweetData = await fetchTweetData(tweetId, apiKey);
      
      // Save tweet data
      const tweetsData = loadTweetsData();
      tweetsData[tweetId] = tweetData;
      saveTweetsData(tweetsData);
      
      // Re-render to show the fetched data
      renderTweets(links);
    } catch (error) {
      // Save error state
      const tweetsData = loadTweetsData();
      tweetsData[tweetId] = { error: error.message };
      saveTweetsData(tweetsData);
      
      // Re-render to show error state
      renderTweets(links);
      
      showMessage(errorMsg, `Failed to fetch tweet data: ${error.message}`);
    }
  }

  // Event listeners
  input.addEventListener('input', () => {
    clearMessages();
    const value = input.value;
    const apiKey = loadApiKey();
    saveBtn.disabled = !isValidTweetUrl(value) || !apiKey;
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = '';
      saveBtn.disabled = true;
      clearMessages();
    }
  });

  // Settings modal handlers
  settingsBtn.addEventListener('click', () => {
    settingsModal.classList.remove('hidden');
    // Load current API key into settings
    const currentKey = loadApiKey();
    settingsApiKey.value = currentKey;
    
    // Update status display
    if (currentKey) {
      apiKeyStatus.classList.remove('hidden');
      apiKeyStatusContent.className = 'p-3 rounded text-sm bg-blue-50 text-blue-800';
      apiKeyStatusContent.textContent = 'API key is configured';
    } else {
      apiKeyStatus.classList.add('hidden');
    }
  });

  closeSettings.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
  });

  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      settingsModal.classList.add('hidden');
    }
  });

  toggleSettingsKey.addEventListener('click', () => {
    const isPassword = settingsApiKey.type === 'password';
    settingsApiKey.type = isPassword ? 'text' : 'password';
    toggleSettingsKey.textContent = isPassword ? 'Hide' : 'Show';
  });

  verifyApiKey.addEventListener('click', async () => {
    const apiKey = settingsApiKey.value.trim();
    
    if (!apiKey) {
      showToast('Please enter an API key first', 'error');
      return;
    }
    
    verifyApiKey.disabled = true;
    verifyApiKey.textContent = 'Verifying...';
    
    try {
      const result = await verifyApiKeyFunction(apiKey);
      
      if (result.valid) {
        // Save the API key
        localStorage.setItem(API_KEY_STORAGE, apiKey);
        
        // Update UI
        apiKeyStatusContent.textContent = `Valid (${result.accountType || 'Unknown'})`;
        apiKeyStatus.className = 'text-green-600 text-sm';
        
        showToast('API key verified! Syncing your saved links...', 'success');
        
        // Sync links from cloud storage
        await syncLinksWithCloud(apiKey);
        
        // Close settings modal
        settingsModal.classList.add('hidden');
        
        // Re-render tweets
        renderTweets(loadLinks());
      } else {
        apiKeyStatusContent.textContent = 'Invalid';
        apiKeyStatus.className = 'text-red-600 text-sm';
        showToast('Invalid API key', 'error');
      }
    } catch (error) {
      apiKeyStatusContent.textContent = 'Invalid';
      apiKeyStatus.className = 'text-red-600 text-sm';
      apiKeyStatus.classList.remove('hidden');
      apiKeyStatusContent.className = 'p-3 rounded text-sm bg-red-50 text-red-800';
      apiKeyStatusContent.textContent = '✗ Verification failed: ' + error.message;
      
      showToast('Verification failed: ' + error.message, 'error');
    } finally {
      verifyApiKey.disabled = false;
      verifyApiKey.textContent = 'Verify Key';
    }
  } catch (error) {
    apiKeyStatusContent.textContent = 'Invalid';
    apiKeyStatus.className = 'text-red-600 text-sm';
    apiKeyStatus.classList.remove('hidden');
    apiKeyStatusContent.className = 'p-3 rounded text-sm bg-red-50 text-red-800';
    apiKeyStatusContent.textContent = '✗ Verification failed: ' + error.message;
    
    showToast('Verification failed: ' + error.message, 'error');
    verifyApiKey.disabled = false;
    verifyApiKey.textContent = 'Verify Key';
  }
});

testSync.addEventListener('click', async () => {
  const apiKey = settingsApiKey.value.trim() || localStorage.getItem(API_KEY_STORAGE);
  
  if (!apiKey) {
    syncStatusContent.textContent = '❌ No API key found. Please enter and verify your API key first.';
    syncStatus.className = 'mt-4';
    syncStatusContent.className = 'p-3 rounded text-sm bg-red-50 text-red-800';
    syncStatus.classList.remove('hidden');
    return;
  }

  testSync.disabled = true;
  testSync.textContent = 'Testing...';
  
  syncStatusContent.textContent = '🔄 Testing cloud sync... Check console for detailed logs.';
  syncStatus.className = 'mt-4';
  syncStatusContent.className = 'p-3 rounded text-sm bg-blue-50 text-blue-800';
  syncStatus.classList.remove('hidden');
  
  try {
    console.log('🧪 SYNC TEST STARTED 🧪');
    console.log('API Key (first 10 chars):', apiKey.substring(0, 10) + '...');
    
    await syncLinksWithCloud(apiKey);
    
    const currentLinks = loadLinks();
    console.log('📊 Final result - Links count:', currentLinks.length);
    
    syncStatusContent.textContent = `✅ Sync test completed! Found ${currentLinks.length} links. Check console for details.`;
    syncStatusContent.className = 'p-3 rounded text-sm bg-green-50 text-green-800';
    
  } catch (error) {
    console.error('🚨 SYNC TEST FAILED:', error);
    syncStatusContent.textContent = `❌ Sync test failed: ${error.message}`;
    syncStatusContent.className = 'p-3 rounded text-sm bg-red-50 text-red-800';
  } finally {
    testSync.disabled = false;
    testSync.textContent = 'Test Sync';
  }
});

clearApiKey.addEventListener('click', () => {
  localStorage.removeItem(API_KEY_STORAGE);
  settingsApiKey.value = '';
  apiKeyStatus.classList.add('hidden');
  syncStatus.classList.add('hidden');
  showToast('API key cleared', 'success');
});

// Escape key to close modals
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!tweetModal.classList.contains('hidden')) {
      tweetModal.classList.add('hidden');
    } else if (!settingsModal.classList.contains('hidden')) {
      settingsModal.classList.add('hidden');
    }
  }
});

// Modal handlers
closeModal.addEventListener('click', () => {
  tweetModal.classList.add('hidden');
});

tweetModal.addEventListener('click', (e) => {
  if (e.target === tweetModal) {
    tweetModal.classList.add('hidden');
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = input.value.trim();

  if (!isValidTweetUrl(url)) {
    showMessage(errorMsg, 'Please enter a valid tweet URL.');
    return;
  }

  const apiKey = loadApiKey();
  if (!apiKey) {
    showMessage(errorMsg, 'Please enter your TwitterAPI.io API key first.');
    return;
  }

  await saveTweetWithData(url);

  input.value = '';
  saveBtn.disabled = true;
    input.focus();
  });

  // On load
  document.addEventListener('DOMContentLoaded', () => {
    input.focus();
    
    // Check if we have an API key and update button state
    const savedApiKey = loadApiKey();
    saveBtn.disabled = true;
    
    
    renderTweets(loadLinks());
  });
})();
