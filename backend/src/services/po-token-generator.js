import fs from 'fs/promises';
import path from 'path';
import { createRequire } from 'module';
import { JSDOM, VirtualConsole } from 'jsdom';

const require = createRequire(import.meta.url);

const packagePath = path.dirname(require.resolve('youtube-po-token-generator/package.json'));
const domContentPath = path.join(packagePath, 'vendor', 'index.html');
const baseContentPath = path.join(packagePath, 'vendor', 'base.js');
const baseAppendContentPath = path.join(packagePath, 'lib', 'inject.js');

const { fetchVisitorData } = require(path.join(packagePath, 'lib', 'workflow.js'));
const { url, userAgent } = require(path.join(packagePath, 'lib', 'consts.js'));

export async function generate() {
  const visitorData = await fetchVisitorData();
  
  const domContent = await fs.readFile(domContentPath, 'utf-8');
  const baseContent = await fs.readFile(baseContentPath, 'utf-8');
  const baseAppendContent = await fs.readFile(baseAppendContentPath, 'utf-8');
  
  let destroy = undefined;
  
  const { poToken } = await new Promise(async (res, rej) => {
    const { window } = new JSDOM(domContent, {
      url,
      pretendToBeVisual: true,
      runScripts: 'dangerously',
      virtualConsole: new VirtualConsole(),
    });
    
    Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, writable: false });
    window.visitorData = visitorData;
    window.onPoToken = (token) => {
      res({ poToken: token });
    };
    window.eval(baseContent.replace(/}\s*\)\(_yt_player\);\s*$/, (matched) => `;${baseAppendContent};${matched}`));
    destroy = () => {
      window.close();
      rej(new Error('Window is closed'));
    };
  }).finally(() => {
    if (destroy) destroy();
  });
  
  return { visitorData, poToken };
}

// Run as CLI if executed directly
import { fileURLToPath } from 'url';
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const result = await generate();
    console.log(JSON.stringify(result));
    process.exit(0);
  } catch (err) {
    console.error(JSON.stringify({ error: err.message || err }));
    process.exit(1);
  }
}
