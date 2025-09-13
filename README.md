# Tweet Link Saver

A minimal single-page application to store tweet links locally in your browser.

## Features

- Paste a valid tweet URL (from `twitter.com` or `x.com`) and save it.
- Links are persisted in `localStorage`, so they remain after page refresh.
- Prevents duplicate links and notifies you if a link is already saved.
- Delete individual links with full keyboard accessibility.
- Keyboard shortcuts:
  - **Enter**: Save the link (when input is focused and valid).
  - **Escape**: Clear the input.
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
