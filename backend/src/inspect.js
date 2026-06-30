import { Platform, Innertube } from 'youtubei.js';

Platform.shim.eval = async (data) => {
  return new Function(data.output)();
};

async function testSeekRanges() {
  const yt = await Innertube.create();
  const videoId = '0COXQA7iRfs';
  
  const clients = ['ANDROID_VR', 'YTMUSIC'];
  
  for (const clientName of clients) {
    console.log(`\n--- Testing Seek Range for: ${clientName} ---`);
    try {
      const info = await yt.getInfo(videoId, { client: clientName });
      const format = info.chooseFormat({ type: 'audio', quality: 'best' });
      
      if (!format) {
        console.log(`No format for ${clientName}`);
        continue;
      }
      
      let url;
      if (typeof format.decipher === 'function') {
        url = await format.decipher(yt.session.player);
      } else {
        url = format.url;
      }
      
      // Request bytes from 2MB to 2.05MB (deep seek)
      const seekFetch = await fetch(url, {
        headers: { Range: 'bytes=2000000-2050000' }
      });
      
      console.log(`Seek Fetch status: ${seekFetch.status} ${seekFetch.statusText}`);
      if (seekFetch.status === 206) {
        console.log(`✅ ${clientName} successfully seeked deep range!`);
      } else {
        console.log(`❌ ${clientName} failed deep range seek with status ${seekFetch.status}`);
      }
    } catch (e) {
      console.error(`Error seeking for ${clientName}:`, e.message);
    }
  }
}

testSeekRanges();
