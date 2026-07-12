import { Innertube } from 'youtubei.js';
import { generate } from './po-token-generator.js';

async function testDirectTvPo() {
  const videoId = 'fsiPzT50ZiM';
  
  try {
    console.log('Generating fresh PO Token...');
    const tokenResult = await generate();
    console.log('PO Token generated successfully.');

    const options = {
      po_token: tokenResult.poToken,
      visitor_data: tokenResult.visitorData,
      user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)'
    };

    console.log('Creating Innertube client with PO Token directly on VPS (no proxy)...');
    const client = await Innertube.create(options);
    
    const clients = ['ANDROID_VR', 'TV'];
    
    for (const clientName of clients) {
      try {
        console.log(`\nResolving stream details using ${clientName} directly...`);
        const info = await client.getInfo(videoId, { client: clientName });
        
        console.log(`Successfully resolved stream info! Playability status: ${info.playability_status?.status}`);
        
        const formats = info.streaming_data?.adaptive_formats || [];
        console.log(`Success! Resolved ${formats.length} formats.`);
        
        const audio = formats.filter(f => f.mime_type?.includes('audio'))[0];
        if (audio) {
          console.log(`Audio Format: ${audio.mime_type}, Has URL: ${!!audio.url}`);
          if (audio.url) {
            console.log(`Audio URL snippet: ${audio.url.slice(0, 100)}...`);
            
            // Test downloading 100 bytes directly from VPS
            const dlResp = await fetch(audio.url, { headers: { Range: 'bytes=0-99' } });
            console.log(`Direct download status from VPS: ${dlResp.status}`);
            if (dlResp.ok || dlResp.status === 206) {
              console.log(`SUCCESS! Resolved and streamed directly using ${clientName} + PO Token!`);
              return;
            }
          }
        } else {
          console.warn('No audio formats returned. Playability reason:', info.playability_status?.reason);
        }
      } catch (innerErr) {
        console.error(`Client ${clientName} failed: ${innerErr.message}`);
      }
    }
  } catch (e) {
    console.error(`FAILED: ${e.message}`, e.stack);
  }
}

testDirectTvPo();
