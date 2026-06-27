const html = `
<!-- codeskin-csp-start -->
<!-- ORIGINAL_CSP: <meta> -->
<meta>
<!-- codeskin-csp-end -->
`;
const cspRegex = /\n<!-- codeskin-csp-start -->\n<!-- ORIGINAL_CSP: (.*?) -->\n.*?<!-- codeskin-csp-end -->\n/s;
console.log(html.match(cspRegex));
