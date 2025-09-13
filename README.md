# Perch 🐦

A powerful offline tweet reading app with unlimited media caching.

## Features

✅ **Offline Reading** - Save tweets for reading without internet  
✅ **Unlimited Media Caching** - Store images and videos locally (GB scale)  
✅ **Video Streaming** - Full video playback with caching  
✅ **Clean Interface** - Distraction-free reading experience  
✅ **Global Access** - Deploy once, access anywhere  

## Quick Start

1. Get an API key from [twitterapi.io](https://twitterapi.io)
2. Open Perch and enter your API key in settings
3. Paste any Twitter/X URL and save
4. Enjoy offline reading with cached media!

## Technology

- **Frontend**: Vanilla JS, HTML5, Tailwind CSS
- **Storage**: IndexedDB for unlimited media caching
- **API**: TwitterAPI.io integration with CORS proxy
- **Deployment**: Netlify-ready with automatic API proxying

## Deployment

Ready for one-click deployment to Netlify with built-in API proxying and HTTPS.
- Clean, minimal UI built with TailwindCSS.

## Getting Started

1. Clone or download this repository.
2. Serve the `index.html` file. The easiest way is with a simple Python HTTP server:

   ```bash
   # Python 3
   python -m http.server 8000
   ```

3. Open your browser and navigate to `http://localhost:8000`.

## Folder Structure

```
├── index.html   # Main HTML file with Tailwind via CDN
├── main.js      # App logic
└── README.md    # This file
```

## License

MIT
