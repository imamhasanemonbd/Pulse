import { getStreamDetails } from './youtube.js';
import dotenv from 'dotenv';
dotenv.config();

// Ensure the proxy worker environment variable is set
process.env.YT_PROXY_WORKER = 'https://polished-band-70c2.imamhasanemonbd.workers.dev';
// Ensure YT_COOKIES is set if available
process.env.YT_COOKIES = process.env.YT_COOKIES || '';

async function testProductionCode() {
  const videoId = 'tdnkkMK3N88';
  
  try {
    console.log(`Calling getStreamDetails for videoId: ${videoId}...`);
    const { client, info } = await getStreamDetails(videoId);
    
    console.log('Successfully resolved stream details! Downloading first chunk...');
    const downloadStream = await info.download({ type: 'audio', quality: 'best' });
    
    const reader = downloadStream.getReader();
    const { value, done } = await reader.read();
    
    if (value && value.length > 0) {
      console.log(`SUCCESS! Read first chunk of size: ${value.length} bytes.`);
    } else {
      console.warn('Read empty chunk.');
    }
  } catch (e) {
    console.error(`FAILED: ${e.message}`, e.stack);
  }
}

testProductionCode();
