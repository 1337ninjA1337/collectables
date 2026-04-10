const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "dist");
const port = Number(process.env.PORT || 4173);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

function sendFile(filePath, response) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Internal Server Error");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
    });
    response.end(data);
  });
}

const server = http.createServer((request, response) => {
  const urlPath = decodeURIComponent((request.url || "/").split("?")[0]);
  let filePath = path.join(root, urlPath);

  if (urlPath === "/") {
    filePath = path.join(root, "index.html");
  }

  if (!filePath.startsWith(root)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (!statError && stats.isDirectory()) {
      sendFile(path.join(filePath, "index.html"), response);
      return;
    }

    if (!statError && stats.isFile()) {
      sendFile(filePath, response);
      return;
    }

    const fallback = path.join(root, urlPath.replace(/^\/+/, ""), "index.html");
    fs.stat(fallback, (fallbackError, fallbackStats) => {
      if (!fallbackError && fallbackStats.isFile()) {
        sendFile(fallback, response);
        return;
      }

      sendFile(path.join(root, "+not-found.html"), response);
    });
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Collectables preview is running at http://127.0.0.1:${port}`);
});
