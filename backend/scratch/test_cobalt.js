async function testCobalt() {
  const videoId = 'tdnkkMK3N88';
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  
  const instances = [
    'https://api.cobalt.tools',
    'https://cobalt.api.ryz.cx',
    'https://api.cobalt.lol',
  ];

  for (const instance of instances) {
    try {
      console.log(`Trying Cobalt instance: ${instance}`);
      const response = await fetch(`${instance}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          url,
          downloadMode: 'audio',
          audioFormat: 'best'
        })
      });

      console.log(`Status: ${response.status}`);
      const data = await response.json();
      console.log('Response:', data);
      if (data.url) {
        console.log(`SUCCESS! URL: ${data.url}`);
        return;
      }
    } catch (e) {
      console.error(`Failed: ${e.message}`);
    }
  }
}

testCobalt();
