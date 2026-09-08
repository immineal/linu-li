from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto("http://127.0.0.1:8000/tools/word-counter/index.html")

        # Give it a moment to load and initialize worker
        time.sleep(1)

        # Inject large text (e.g. 1000 words repeating "apple banana orange ")
        large_text = "Apple banana orange. " * 1000
        # Use page.fill to trigger input event, or evaluate
        page.locator("#textInput").fill(large_text)

        # Wait for worker debouncing to fire (300ms + buffer)
        time.sleep(1)

        # Assert metrics updated
        word_count = page.locator("#wordCount").inner_text()
        assert word_count == "3,000", f"Expected 3000 words, got {word_count}"

        # Assert keyword density
        top_keyword = page.locator("#keywordList .keyword-item .keyword-word").nth(0).inner_text()
        top_keyword_count = page.locator("#keywordList .keyword-item .keyword-count").nth(0).inner_text()
        assert top_keyword == "apple", f"Expected top keyword 'apple', got {top_keyword}"
        assert top_keyword_count == "1000", f"Expected 1000 count, got {top_keyword_count}"

        # Assert Flesch-Kincaid score (it shouldn't be 0 or empty)
        flesch_score = page.locator("#fleschScore").inner_text()
        assert flesch_score != "0" and flesch_score != "", f"Expected valid Flesch score, got {flesch_score}"

        # Test scroll and sticky header
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")

        print("Playwright UI Verification Passed!")
        browser.close()

if __name__ == "__main__":
    run()
