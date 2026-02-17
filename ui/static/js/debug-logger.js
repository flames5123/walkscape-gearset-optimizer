/**
 * Debug Logger - Captures console logs to downloadable file
 * 
 * Usage:
 * 1. Add to index.html: <script src="/static/js/debug-logger.js"></script>
 * 2. In console: window.debugLogger.start()
 * 3. Perform actions
 * 4. In console: window.debugLogger.download()
 */

class DebugLogger {
    constructor() {
        this.logs = [];
        this.isCapturing = false;
        this.originalConsole = {};
    }

    start() {
        if (this.isCapturing) {
            console.warn('Logger already capturing');
            return;
        }

        this.logs = [];
        this.isCapturing = true;

        // Store original console methods
        this.originalConsole = {
            log: console.log,
            warn: console.warn,
            error: console.error,
            info: console.info
        };

        // Override console methods
        const self = this;

        console.log = function (...args) {
            self.capture('LOG', args);
            self.originalConsole.log.apply(console, args);
        };

        console.warn = function (...args) {
            self.capture('WARN', args);
            self.originalConsole.warn.apply(console, args);
        };

        console.error = function (...args) {
            self.capture('ERROR', args);
            self.originalConsole.error.apply(console, args);
        };

        console.info = function (...args) {
            self.capture('INFO', args);
            self.originalConsole.info.apply(console, args);
        };

        this.originalConsole.log('%c📝 Debug logger started', 'color: green; font-weight: bold');
        this.originalConsole.log('Use window.debugLogger.stop() to stop capturing');
        this.originalConsole.log('Use window.debugLogger.download() to save logs');
    }

    stop() {
        if (!this.isCapturing) {
            console.warn('Logger not capturing');
            return;
        }

        // Restore original console methods
        console.log = this.originalConsole.log;
        console.warn = this.originalConsole.warn;
        console.error = this.originalConsole.error;
        console.info = this.originalConsole.info;

        this.isCapturing = false;
        this.originalConsole.log(`%c📝 Debug logger stopped - captured ${this.logs.length} messages`, 'color: green; font-weight: bold');
    }

    capture(level, args) {
        const timestamp = new Date().toISOString();
        const message = args.map(arg => {
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg, null, 2);
                } catch (e) {
                    return String(arg);
                }
            }
            return String(arg);
        }).join(' ');

        this.logs.push({
            timestamp,
            level,
            message
        });
    }

    download(filename = 'debug-logs.txt') {
        if (this.logs.length === 0) {
            this.originalConsole.warn('No logs to download');
            return;
        }

        // Format logs as text
        const text = this.logs.map(log => {
            return `[${log.timestamp}] ${log.level}: ${log.message}`;
        }).join('\n');

        // Create blob and download
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.originalConsole.log(`%c📥 Downloaded ${this.logs.length} log messages to ${filename}`, 'color: green; font-weight: bold');
    }

    clear() {
        this.logs = [];
        this.originalConsole.log('%c🗑️ Logs cleared', 'color: orange; font-weight: bold');
    }

    filter(keyword) {
        return this.logs.filter(log =>
            log.message.toLowerCase().includes(keyword.toLowerCase())
        );
    }

    print(keyword = null) {
        const logs = keyword ? this.filter(keyword) : this.logs;

        this.originalConsole.log(`%c📋 Showing ${logs.length} log messages${keyword ? ` (filtered by: ${keyword})` : ''}`, 'color: blue; font-weight: bold');

        logs.forEach(log => {
            const style = {
                'LOG': 'color: gray',
                'INFO': 'color: blue',
                'WARN': 'color: orange',
                'ERROR': 'color: red'
            }[log.level] || '';

            this.originalConsole.log(`%c[${log.timestamp}] ${log.level}:`, style, log.message);
        });
    }
}

// Create global instance
window.debugLogger = new DebugLogger();

// Add helpful message
console.log('%c🔧 Debug Logger Available', 'color: cyan; font-weight: bold; font-size: 14px');
console.log('Commands:');
console.log('  window.debugLogger.start()           - Start capturing logs');
console.log('  window.debugLogger.stop()            - Stop capturing');
console.log('  window.debugLogger.download()        - Download logs as file');
console.log('  window.debugLogger.print("keyword")  - Print filtered logs');
console.log('  window.debugLogger.clear()           - Clear captured logs');
