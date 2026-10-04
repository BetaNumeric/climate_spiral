async function installVideoSessionHook(page) {
  await page.route('**/video-controller.mjs', async route => {
    const response = await route.fetch();
    const source = (await response.text()).replaceAll('\r\n', '\n');
    const marker = '    return {\n        setupUI,';
    if (!source.includes(marker)) throw new Error('Video controller test hook marker is missing.');
    await route.fulfill({ response, body: source.replace(marker,
      '    return {\n        get testRecording() { return videoExport; },\n        setupUI,') });
  });
}

module.exports = { installVideoSessionHook };
