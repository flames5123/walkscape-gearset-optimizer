/**
 * Emoji tint utility — cross-platform emoji color tinting.
 * 
 * Desktop/Android: `color:rgba(0,0,0,0.5);text-shadow:0 0 0 COLOR`
 * iOS: Canvas-based tinting. Renders emoji to canvas, applies color overlay
 * using compositing, returns as <img> data URL.
 */

(function () {
    var _isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ||
        (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

    // Cache tinted emoji images to avoid re-rendering
    var _cache = {};

    function _isValidColor(color) {
        if (!color || typeof color !== 'string') return false;
        return /^(#|rgb|hsl|var\()/.test(color.trim());
    }

    /**
     * Render a tinted emoji as a canvas data URL (for iOS).
     * Uses source-atop compositing to overlay color on emoji pixels.
     */
    function _canvasTint(emoji, color, size) {
        size = size || 64;
        var key = emoji + '|' + color + '|' + size;
        if (_cache[key]) return _cache[key];

        var canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        var ctx = canvas.getContext('2d');

        // Draw emoji
        ctx.font = size * 0.8 + 'px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(emoji, size / 2, size / 2);

        // Apply color overlay using source-atop (only colors existing pixels)
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.7;
        ctx.fillRect(0, 0, size, size);

        var url = canvas.toDataURL();
        _cache[key] = url;
        return url;
    }

    function emojiTintStyle(color) {
        if (!color || !_isValidColor(color)) return '';
        if (_isIOS) return '';  // iOS uses canvas approach via tintedEmoji
        return 'color:rgba(0,0,0,0.5);text-shadow:0 0 0 ' + color;
    }

    function emojiTintCSS(color) {
        if (!color || !_isValidColor(color)) {
            return { color: '', 'text-shadow': '' };
        }
        if (_isIOS) return {};  // iOS uses canvas approach
        return { color: 'rgba(0,0,0,0.5)', 'text-shadow': '0 0 0 ' + color };
    }

    /**
     * Returns tinted emoji HTML.
     * Desktop: <span> with text-shadow.
     * iOS: <img> with canvas-rendered tinted emoji.
     */
    function tintedEmoji(emoji, color) {
        if (!color || !_isValidColor(color)) return emoji;
        if (_isIOS) {
            var url = _canvasTint(emoji, color);
            return '<img src="' + url + '" alt="' + emoji + '" style="width:1em;height:1em;vertical-align:middle" />';
        }
        return '<span style="color:rgba(0,0,0,0.5);text-shadow:0 0 0 ' + color + '">' + emoji + '</span>';
    }

    /**
     * For contexts where emoji is set via .text() or inserted into HTML.
     * On iOS with a color, returns an <img> tag string.
     * Without color, returns the plain emoji.
     */
    function emojiForPlatform(emoji, color) {
        if (_isIOS && color && _isValidColor(color)) {
            var url = _canvasTint(emoji, color);
            return '<img src="' + url + '" alt="' + emoji + '" style="width:1em;height:1em;vertical-align:middle" />';
        }
        return emoji;
    }

    /**
     * Set emoji content on a jQuery element with optional tint.
     * On iOS with color: uses .html() with canvas-rendered <img>.
     * Otherwise: uses .text() with plain emoji + style attr.
     */
    function setEmojiOnElement($el, emoji, color) {
        if (_isIOS && color && _isValidColor(color)) {
            var url = _canvasTint(emoji, color);
            $el.html('<img src="' + url + '" alt="' + emoji + '" style="width:1em;height:1em;vertical-align:middle" />').attr('style', '');
        } else {
            $el.text(emoji).attr('style', emojiTintStyle(color));
        }
    }

    window.emojiTintStyle = emojiTintStyle;
    window.emojiTintCSS = emojiTintCSS;
    window.tintedEmoji = tintedEmoji;
    window.emojiForPlatform = emojiForPlatform;
    window.setEmojiOnElement = setEmojiOnElement;
    window._isIOSEmoji = _isIOS;
    window._canvasTintEmoji = _canvasTint;

    window._emojiTintDebug = {
        isIOS: _isIOS,
        technique: _isIOS ? 'canvas compositing' : 'text-shadow',
        ua: navigator.userAgent
    };

    if (_isIOS) document.documentElement.classList.add('ios');

    setTimeout(function () {
        console.log('[emoji-tint] isIOS=' + _isIOS + ', technique=' + (_isIOS ? 'canvas' : 'text-shadow'));
    }, 3000);
})();
