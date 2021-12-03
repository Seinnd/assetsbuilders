const BROWSER = process.env.BROWSER || "chrome --use-fake-ui-for-media-stream --use-fake-device-for-media-stream";

module.exports = {
  "browsers": BROWSER,
  "hostname": "localhost",
  "src": "tests/",
  "screenshots": {
    "path": "screenshots/",
    "takeOnFails": true,
    "thumbnails": false,
  },
  "assertionTimeout": 10000,
  "selectorTimeout": 40000,

  /*"skipJsErrors": true,
  "clientScripts": [ { "content": `
    window.addEventListener('error', function (e) {
            if (e instanceof Error && e.message.includes('_jp')) {
              console.log('Ignoring sockjs related error');
              return;
            }
            throw e;
        });
  ` } ]*/
}
