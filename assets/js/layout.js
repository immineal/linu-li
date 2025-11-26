if ('serviceWorker' in navigator) {
    // Adjust path based on whether we are deep in tools or at root
    const swPath = window.location.pathname.includes('/tools/') ? '../../assets/sw.js' : './assets/sw.js';
    navigator.serviceWorker.register(swPath)
        .then(() => console.log('Service Worker Registered'))
        .catch(err => console.error('SW Registration Failed', err));
}

document.addEventListener('DOMContentLoaded', () => {
    // 1. Determine paths based on current location
    // Check if we are inside the 'tools' directory
    const inToolsDir = window.location.pathname.includes('/tools/');
    const rootPath = inToolsDir ? '../../' : './';
    
    // 2. Inject Header
    const headerHTML = `
    <header class="main-header">
        <nav>
            <a href="${rootPath}" class="logo-link">Tools for Everyone</a>
            <div style="display:flex; gap: 1.5rem; align-items: center;">
                <button id="theme-toggle" class="theme-switch" aria-label="Toggle Dark Mode">
                    <div class="switch-track">
                        <div class="switch-thumb"></div>
                    </div>
                </button>
            </div>
        </nav>
    </header>`;
    
    // 3. Inject Footer
    const footerHTML = `
    <footer style="text-align: center; padding: 3rem 1rem; opacity: 0.8; font-size: 0.9rem; border-top: 1px solid var(--border); margin-top: auto;">
        
        <!-- Donation Section -->
        <div style="margin-bottom: 1.5rem;">
            <a href="https://ko-fi.com/linuslinhof" target="_blank" rel="noopener noreferrer" class="donate-btn">
                <span>☕</span> Buy me a coffee
            </a>
        </div>

        <p style="margin: 0 auto; text-align: center;">
            &copy; ${new Date().getFullYear()} Linus Linhof. Built for utility.
        </p>
        
        <!-- Links with auto margins -->
        <p style="margin: 0.5rem auto 0; opacity: 0.7; text-align: center;">
            <a href="${rootPath}impressum.html">Impressum / Legal</a> &bull; 
            <a href="${rootPath}privacy.html">Privacy / Datenschutz</a>
        </p>
    </footer>
    <div id="toast-container" class="toast-container"></div>`;

    document.body.insertAdjacentHTML('afterbegin', headerHTML);
    document.body.insertAdjacentHTML('beforeend', footerHTML);

    // 4. Theme Logic
    const themeToggle = document.getElementById('theme-toggle');
    const savedTheme = localStorage.getItem('theme');
    
    if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.body.classList.add('dark-mode');
    }

    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            document.body.classList.toggle('dark-mode');
            const isDark = document.body.classList.contains('dark-mode');
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
        });
    }

    // 5. Auto-Save State Logic (Global)
    const pageId = window.location.pathname; // Unique key per tool

    const inputsToSave = document.querySelectorAll('textarea[id], input[type="text"][id], select[id]');
    
    inputsToSave.forEach(input => {
        // Skip inputs that explicitly say no-save
        if(input.getAttribute('data-no-save')) return;

        const storageKey = `autosave_${pageId}_${input.id}`;
        
        // Restore
        const savedValue = localStorage.getItem(storageKey);
        if (savedValue !== null && input.value === '') { 
            input.value = savedValue;
        }

        // Save on Input
        input.addEventListener('input', (e) => {
            localStorage.setItem(storageKey, e.target.value);
        });
        
        // Save on Change (for selects)
        input.addEventListener('change', (e) => {
            localStorage.setItem(storageKey, e.target.value);
        });
    });

    // Helper: Clear specific autosave
    window.clearAutoSave = function(elementIds) {
        if (!Array.isArray(elementIds)) elementIds = [elementIds];
        elementIds.forEach(id => {
            localStorage.removeItem(`autosave_${pageId}_${id}`);
        });
    }
});

/* === GLOBAL UTILITY FUNCTIONS === */

// Show Toast Notification
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return; 
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Copy Text to Clipboard
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('Copied to clipboard!', 'success');
    }).catch(err => {
        showToast('Failed to copy', 'error');
    });
}

// Format File Size (Bytes -> KB/MB)
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Setup Drag and Drop Zone
function setupDropZone(dropZone, fileInput, onFilesSelected) {
    if (!dropZone || !fileInput) return;

    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        if (e.dataTransfer.files.length) {
            fileInput.files = e.dataTransfer.files;
            onFilesSelected(e.dataTransfer.files); 
        }
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files.length) {
            onFilesSelected(fileInput.files);
        }
    });
}

function setupSEO() {
    // 1. Get Page Details
    const h1 = document.querySelector('h1');
    const descP = document.querySelector('.tool-header p') || document.querySelector('p'); // Fallback to first p
    
    // Default values if H1 is missing
    const titleText = h1 ? h1.innerText + ' | Linus Linhof' : 'Linus Linhof Toolbox';
    const descText = descP ? descP.innerText : 'A privacy-first suite of web utilities.';
    const currentUrl = window.location.href;
    
    // Determine path to social image (assuming you put one at assets/og-image.jpg)
    // We need to calculate relative path back to root
    const inToolsDir = window.location.pathname.includes('/tools/');
    const origin = window.location.origin;
    // Replace this URL with your actual hosted image URL for best social reliability
    const imagePath = `${origin}/assets/og-image.jpg`; 

    // 2. Set Document Title
    document.title = titleText;

    // 3. Helper to update/create meta tags
    const setMeta = (name, value, isProperty = false) => {
        const attr = isProperty ? 'property' : 'name';
        let element = document.querySelector(`meta[${attr}="${name}"]`);
        if (!element) {
            element = document.createElement('meta');
            element.setAttribute(attr, name);
            document.head.appendChild(element);
        }
        element.setAttribute('content', value);
    };

    // 4. Set Standard Meta
    setMeta('description', descText);
    setMeta('theme-color', '#faf6f2');

    // 5. Set Open Graph (Facebook/LinkedIn/Discord)
    setMeta('og:title', titleText, true);
    setMeta('og:description', descText, true);
    setMeta('og:image', imagePath, true);
    setMeta('og:url', currentUrl, true);
    setMeta('og:type', 'website', true);

    // 6. Set Twitter Card
    setMeta('twitter:card', 'summary_large_image');
    setMeta('twitter:title', titleText);
    setMeta('twitter:description', descText);
    setMeta('twitter:image', imagePath);
}

// === CALL IT INSIDE YOUR EXISTING LISTENER ===
document.addEventListener('DOMContentLoaded', () => {
    // ... your existing header/footer injection code ...

    // Run SEO Setup
    setupSEO(); 
    
    // ... rest of your code ...
});