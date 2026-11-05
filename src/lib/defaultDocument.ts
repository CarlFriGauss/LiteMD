/**
 * Default welcome & verification document loaded when LiteMD starts without a CLI file argument.
 * Demonstrates all 5 Mandatory Math Edge Cases from AGENT.md Phase 4 plus GFM tables,
 * matrices, standalone LaTeX environments, task lists, code blocks, and footnotes.
 */

export const DEFAULT_DOCUMENT = `# LiteMD — Ultra-Lightweight Markdown & Mathematical Notebook

Welcome to **LiteMD**. Engineered in **Rust + Tauri v2** with a zero-bloat **5-Stage Math-First Pre-Parser** and **Dirty-Region Block Cache**. Every keystroke updates only the mutated DOM block in under a millisecond.

---

## 1. Universal Mathematical Syntax & Edge-Case Verification

### Edge Case 1: Subscripts & Asterisks in Inline Math
Standard Markdown parsers mangle underscores and asterisks inside math. LiteMD masks math tokens before Markdown parsing:
Let $x_1, x_2, \\dots, x_n$ be a sequence in $\\mathcal{H}$ and let the adjoint satisfy $A^* A = I$ and $u_i^* v_j = \\delta_{ij}$.

### Edge Case 2: LaTeX Round & Square Bracket Delimiters
Both standard LaTeX inline \`\\( ... \\)\` and display \`\\[ ... \\]\` delimiters work natively alongside dollar signs:
Given the continuous limit \\( \\lim_{x \\to \\infty} f(x) = L \\), the Gaussian integral evaluates to:

\\[ \\int_{-\\infty}^{\\infty} e^{-x^2} \\, dx = \\sqrt{\\pi} \\]

### Edge Case 3: Whitespace-Padded Single Dollars
Whether authored for Pandoc or browser extensions, padded inline math $ \\alpha + \\beta = \\gamma $ renders identically to tight inline math $\\alpha + \\beta = \\gamma$, while currency like $50 and $100 remains plain text.

### Edge Case 4: Multi-Line Matrices & Blank Lines Inside Display Math
Blank lines and \`\\\\\` row breaks inside \`$$ ... $$\` blocks never fracture the parser:

$$
\\begin{bmatrix}
a_{11} & a_{12} & \\cdots & a_{1n} \\\\

a_{21} & a_{22} & \\cdots & a_{2n} \\\\

\\vdots & \\vdots & \\ddots & \\vdots \\\\
a_{m1} & a_{m2} & \\cdots & a_{mn}
\\end{bmatrix}
\\begin{bmatrix}
x_1 \\\\
x_2 \\\\
\\vdots \\\\
x_n
\\end{bmatrix}
=
\\begin{bmatrix}
b_1 \\\\
b_2 \\\\
\\vdots \\\\
b_m
\\end{bmatrix}
$$

### Edge Case 5: Absolute Value Bars Inside GFM Pipe Tables
Unescaped vertical bars \`|\` inside inline math never break GitHub Flavored Markdown table columns:

| Metric / Norm | Mathematical Definition | Triangle Inequality |
| :--- | :---: | :--- |
| Manhattan ($L_1$) | $|x| + |y|$ | $|x + y| \\le |x| + |y|$ |
| Euclidean ($L_2$) | $\\sqrt{|x_1|^2 + |x_2|^2}$ | $\\|u + v\\|_2 \\le \\|u\\|_2 + \\|v\\|_2$ |
| Chebyshev ($L_\\infty$) | $\\max(|x - x_0|, |y - y_0|)$ | $|x - y| \\le \\epsilon$ |

---

## 2. Standalone LaTeX Environments & Spectral Calculus

Standalone \`\\begin{align*} ... \\end{align*}\` and \`\\begin{cases} ... \\end{cases}\` environments render automatically without requiring outer \`$$\` wrappers[^1]:

\\begin{align*}
\\mathcal{F}\\{f(t)\\}(\\omega) &= \\int_{-\\infty}^{\\infty} f(t) e^{-i\\omega t} \\, dt \\\\
\\nabla \\times \\mathbf{E} &= -\\frac{\\partial \\mathbf{B}}{\\partial t}
\\end{align*}

$$
f(x) = \\begin{cases}
\\frac{\\sin(x)}{x} & \\text{if } x \\neq 0 \\\\
1 & \\text{if } x = 0
\\end{cases}
$$

---

## 3. Code Protection, Slash Commands & Workflow Checklist

Type \`/math\`, \`/matrix\`, \`/align\`, \`/table\`, or \`/code\` followed by **Tab** or **Space** to expand clean boilerplate blocks without intrusive autocomplete popups.

\`\`\`rust
// Dollar signs and underscores inside fenced code are 100% protected:
fn compute_cost(unit_price: f64) -> String {
    let msg = "Total: $100_000 * $200_000";
    format!("{}: {}", msg, unit_price)
}
\`\`\`

- [x] **Engine A (Split-Pane Live Preview):** Bidirectional \`data-source-line\` scroll sync (\`Ctrl+\\\`)
- [x] **Engine B (Inline Live-Rendering Mode):** Click any equation or paragraph to edit raw source in place (\`Ctrl+E\`)
- [x] **Intelligent Visual Soft-Wrapping:** Graphical column wrapping (\`↪\` gutter cue) with zero raw \`\\n\` mutation
- [x] **Theme, Typography & Layout Studio:** Open the Studio drawer (\`Ctrl+,\`) or toggle the **Click-to-Style Inspector** brush in the toolbar

[^1]: All KaTeX scripts, stylesheets, and \`.woff2\` fonts are bundled 100% locally for instant offline rendering.
`;
