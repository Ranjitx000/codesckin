const originalCspTag = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' https: data: blob: vscode-remote-resource:; media-src 'none'; frame-src 'self' vscode-webview:; object-src 'none'; script-src 'self' 'unsafe-eval' vscode-remote-resource:; style-src 'self' 'unsafe-inline' vscode-remote-resource:; connect-src 'self' https: wss: vscode-remote-resource:; worker-src 'self' vscode-remote-resource: data: blob:; require-trusted-types-for 'script';">`;

const contentMatch = originalCspTag.match(/content="([^"]+)"/i);
const originalContent = contentMatch[1];
const relaxedContent = originalContent.split(';').map(directive => {
    const trimmed = directive.trim();
    if (!trimmed) return '';
    if (trimmed.toLowerCase().startsWith('require-trusted-types-for')) return '';
    return trimmed + ' vscode-file: vscode-app: vscode-webview: vscode-webview-resource: blob: data:';
}).filter(Boolean).join('; ') + ';';

console.log("OLD:");
console.log(originalContent);
console.log("NEW:");
console.log(relaxedContent);
