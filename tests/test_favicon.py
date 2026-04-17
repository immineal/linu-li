import asyncio
from playwright.async_api import async_playwright
import zipfile
import io
import json

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        # Assuming we host it locally on port 8000 for the test
        # We will use python3 -m http.server 8000
        await page.goto("http://127.0.0.1:8000/tools/favicon-maker/index.html")

        # Set background color to test manifest dynamic color
        await page.evaluate('document.getElementById("bgColor").value = "#ff0000"')
        await page.evaluate('document.getElementById("bgColor").dispatchEvent(new Event("change"))')

        # Click the zip download button and intercept download
        async with page.expect_download() as download_info:
            await page.click('#downloadZip')

        download = await download_info.value
        path = await download.path()

        # Verify zip contents
        with zipfile.ZipFile(path, 'r') as z:
            namelist = z.namelist()
            assert 'manifest.json' in namelist, "manifest.json is missing from zip"
            assert 'site.webmanifest' in namelist, "site.webmanifest is missing from zip"
            assert 'favicon.ico' in namelist, "favicon.ico is missing from zip"
            assert 'apple-touch-icon.png' in namelist, "apple-touch-icon.png is missing from zip"

            # Check manifest content
            manifest_content = z.read('manifest.json').decode('utf-8')
            manifest = json.loads(manifest_content)

            assert manifest.get('start_url') == '/', "start_url should be /"
            assert manifest.get('theme_color') == '#ff0000', "theme_color should be #ff0000"
            assert manifest.get('background_color') == '#ff0000', "background_color should be #ff0000"

        print("ZIP generation and manifest updates work successfully.")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
