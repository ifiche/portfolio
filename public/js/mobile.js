document.addEventListener('DOMContentLoaded', function() {
    // Add touch device class to body
    if ('ontouchstart' in window || navigator.maxTouchPoints) {
        document.body.classList.add('touch-device');
        
        // Make interactive elements more touch-friendly
        const touchElements = document.querySelectorAll('button, a, [role="button"], input[type="submit"]');
        touchElements.forEach(el => {
            el.style.minWidth = '44px';
            el.style.minHeight = '44px';
        });
        
        // Prevent zoom on form inputs
        const inputs = document.querySelectorAll('input, select, textarea');
        inputs.forEach(input => {
            input.addEventListener('focus', () => {
                document.body.style.zoom = '1.0';
            });
        });
    }
    
    // Handle viewport for iOS devices
    if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
        const viewport = document.querySelector('meta[name="viewport"]');
        if (viewport) {
            viewport.content = viewport.content + ', maximum-scale=1.0';
        }
    }
});
