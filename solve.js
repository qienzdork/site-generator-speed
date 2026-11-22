// sitegen — a fast drop-in for makefun-site 1.0.0.
//
// Written from the makefun-site README (the spec) and from black-box probes
// of the reference program's outputs on crafted inputs. No reference code
// was copied: every function below is an original implementation of the
// spec's front matter, template dialect, Markdown subset, slug rule and
// report, tuned for CPU time (single-pass scanners, no regex in hot paths,
// templates compiled once per case, slugs memoised per case).
//
// run(input) returns, for one case's { site, templates, files }, the output
// tree makefun-site 1.0.0's build returns: a JSON object of every output
// path and that file's text, byte for byte.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
// Characters a backslash may escape in inline Markdown.
const ESCAPABLE = '\\`*_[]()#+-.!>';
const MARK_RE = /\p{M}/gu;
const HAS_SPECIAL = /[&<>"']/;

// ------------------------------------------------------------------ text

/** HTML-escape &, <, >, " and '. */
function esc(s) {
  if (!HAS_SPECIAL.test(s)) return s;
  let out = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    let rep = null;
    if (c === 38) rep = '&amp;';
    else if (c === 60) rep = '&lt;';
    else if (c === 62) rep = '&gt;';
    else if (c === 34) rep = '&quot;';
    else if (c === 39) rep = '&#39;';
    if (rep !== null) {
      out += s.slice(start, i) + rep;
      start = i + 1;
    }
  }
  return start === 0 ? s : out + s.slice(start);
}

/** True when the line holds only spaces and tabs. */
function isBlank(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** Drop spaces and tabs from both ends. */
function trimST(s) {
  let a = 0;
  let b = s.length;
  while (a < b && (s.charCodeAt(a) === 32 || s.charCodeAt(a) === 9)) a++;
  while (b > a && (s.charCodeAt(b - 1) === 32 || s.charCodeAt(b - 1) === 9)) b--;
  return s.slice(a, b);
}

/** Drop spaces and tabs from the end. */
function trimEndST(s) {
  let b = s.length;
  while (b > 0 && (s.charCodeAt(b - 1) === 32 || s.charCodeAt(b - 1) === 9)) b--;
  return s.slice(0, b);
}

// ------------------------------------------------------------------ slug

/** makefun-site's slug rule: NFKD, combining marks dropped, A-Z lowered,
 *  each run of other characters one '-', none at either end, cut to 64
 *  (a '-' left at the cut dropped), 'untitled' when nothing is left. */
function slugifyRaw(s) {
  const t = s.normalize('NFKD').replace(MARK_RE, '');
  let out = '';
  let dash = false;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c >= 97 && c <= 122) { out += t[i]; dash = false; }
    else if (c >= 48 && c <= 57) { out += t[i]; dash = false; }
    else if (c >= 65 && c <= 90) { out += String.fromCharCode(c + 32); dash = false; }
    else if (!dash) { out += '-'; dash = true; }
  }
  let a = 0;
  let b = out.length;
  while (a < b && out.charCodeAt(a) === 45) a++;
  while (b > a && out.charCodeAt(b - 1) === 45) b--;
  let r = out.slice(a, b);
  if (r.length > 64) {
    r = r.slice(0, 64);
    if (r.charCodeAt(63) === 45) r = r.slice(0, 63);
  }
  return r === '' ? 'untitled' : r;
}

// ------------------------------------------------------------------ dates

function isLeap(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** A real day from 1970-01-01 to 2099-12-31, written YYYY-MM-DD. */
function validDate(v) {
  if (v.length !== 10 || v.charCodeAt(4) !== 45 || v.charCodeAt(7) !== 45) return false;
  for (let i = 0; i < 10; i++) {
    if (i === 4 || i === 7) continue;
    const c = v.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  const y = (v.charCodeAt(0) - 48) * 1000 + (v.charCodeAt(1) - 48) * 100 + (v.charCodeAt(2) - 48) * 10 + (v.charCodeAt(3) - 48);
  const m = (v.charCodeAt(5) - 48) * 10 + (v.charCodeAt(6) - 48);
  const d = (v.charCodeAt(8) - 48) * 10 + (v.charCodeAt(9) - 48);
  if (y < 1970 || y > 2099 || m < 1 || m > 12) return false;
  const dim = DAYS_IN_MONTH[m - 1] + (m === 2 && isLeap(y) ? 1 : 0);
  return d >= 1 && d <= dim;
}

/** The date in words from the string alone: 2026-11-09 is 9 November 2026. */
function dateLong(ds) {
  if (!ds) return '';
  const m = (ds.charCodeAt(5) - 48) * 10 + (ds.charCodeAt(6) - 48);
  const d = (ds.charCodeAt(8) - 48) * 10 + (ds.charCodeAt(9) - 48);
  return d + ' ' + MONTHS[m - 1] + ' ' + ds.slice(0, 4);
}

// ------------------------------------------------------------------ front matter

const KNOWN_KEYS = { title: 1, summary: 1, date: 1, tags: 1, draft: 1, layout: 1, slug: 1 };
const DATE_ERROR = 'not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)';

function parseStringValue(key, v) {
  if (v.charCodeAt(0) === 34) {
    // Quoted: "...", whose only escapes are \" and \\, with no other quote inside.
    let out = '';
    for (let i = 1; i < v.length; i++) {
      const c = v.charCodeAt(i);
      if (c === 92) {
        const nx = v.charCodeAt(i + 1);
        if (nx === 34) { out += '"'; i++; }
        else if (nx === 92) { out += '\\'; i++; }
        else return { error: `key "${key}": a quoted string holds an escape other than \\" or \\\\` };
      } else if (c === 34) {
        if (i !== v.length - 1) return { error: `key "${key}": a quoted string is not closed` };
        return { value: out };
      } else out += v[i];
    }
    return { error: `key "${key}": a quoted string is not closed` };
  }
  if (v.charCodeAt(0) === 91) return { error: `key "${key}": a bare string opens on [` };
  return { value: v };
}

function parseTagsValue(v) {
  if (v.length < 2 || v.charCodeAt(0) !== 91 || v.charCodeAt(v.length - 1) !== 93) {
    return { error: 'key "tags": not a list [a, b]' };
  }
  const inner = v.slice(1, -1);
  if (inner.trim() === '') return { value: [] };
  const parts = inner.split(',');
  const tags = [];
  for (let k = 0; k < parts.length; k++) {
    const t = parts[k].trim();
    if (t === '' || t.indexOf('"') !== -1 || t.indexOf('[') !== -1 || t.indexOf(']') !== -1) {
      return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
    }
    tags.push(t);
  }
  return { value: tags };
}

function isTemplateName(v) {
  if (v === '') return false;
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (!((c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45)) return false;
  }
  return true;
}

function isSlugValue(v) {
  if (v === '' || v.length > 64) return false;
  let prevDash = true; // a leading '-' fails
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c === 45) {
      if (prevDash) return false;
      prevDash = true;
    } else if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) prevDash = false;
    else return false;
  }
  return !prevDash; // a trailing '-' fails
}

/** One front-matter value, by its key. Returns { value } or { error }. */
function parseKeyValue(key, raw) {
  if (key === 'title' || key === 'summary') return parseStringValue(key, raw);
  if (key === 'date') {
    return validDate(raw) ? { value: raw } : { error: `key "date": ${DATE_ERROR}` };
  }
  if (key === 'tags') return parseTagsValue(raw);
  if (key === 'draft') {
    if (raw === 'true') return { value: true };
    if (raw === 'false') return { value: false };
    return { error: 'key "draft": true or false' };
  }
  if (key === 'layout') {
    return isTemplateName(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
  }
  // slug
  return isSlugValue(raw) ? { value: raw } : { error: 'key "slug": not a slug' };
}

/**
 * A source's front matter and body. Returns { fm, body } or { error }.
 * Line numbers are counted from 1 at the opening ---.
 */
function parseFrontMatter(content) {
  let nl = content.indexOf('\n');
  const first = nl === -1 ? content : content.slice(0, nl);
  if (first !== '---') return { error: 'no front matter' };
  // Find the closing line, exactly '---'.
  let pos = nl === -1 ? content.length : nl + 1;
  let closePos = -1;
  let closeEnd = -1;
  while (pos < content.length) {
    const eol = content.indexOf('\n', pos);
    const lineEnd = eol === -1 ? content.length : eol;
    if (content.slice(pos, lineEnd) === '---') {
      closePos = pos;
      closeEnd = eol === -1 ? content.length : eol + 1;
      break;
    }
    pos = lineEnd + 1;
  }
  if (closePos === -1) return { error: 'the front matter is not closed' };
  const fm = {};
  let p = nl + 1;
  let n = 1;
  while (p < closePos) {
    const eol = content.indexOf('\n', p);
    const lineEnd = eol === -1 ? closePos : Math.min(eol, closePos);
    const line = content.slice(p, lineEnd);
    n++;
    if (!isBlank(line) && line.charCodeAt(0) !== 35) {
      // key: value — a key of a-z and _, a colon, one space and the value.
      let ki = 0;
      while (ki < line.length) {
        const c = line.charCodeAt(ki);
        if ((c >= 97 && c <= 122) || c === 95) ki++;
        else break;
      }
      const key = line.slice(0, ki);
      let bad = ki === 0;
      if (ki >= line.length || line.charCodeAt(ki) !== 58) bad = true;
      else if (ki + 1 >= line.length) {
        // 'key:' with nothing after it: the key has no value.
        return { error: `key "${key}" has no value` };
      } else if (line.charCodeAt(ki + 1) !== 32) bad = true;
      if (bad) return { error: `line ${n} is not "key: value"` };
      if (!KNOWN_KEYS[key]) return { error: `unknown key "${key}"` };
      const raw = trimEndST(line.slice(ki + 2));
      const parsed = parseKeyValue(key, raw);
      if (parsed.error) return { error: parsed.error };
      if (Object.prototype.hasOwnProperty.call(fm, key)) {
        return { error: `key "${key}" is given twice` };
      }
      fm[key] = parsed.value;
    }
    p = lineEnd + 1;
  }
  if (!Object.prototype.hasOwnProperty.call(fm, 'title')) return { error: 'no title' };
  return { fm, body: content.slice(closeEnd) };
}

// ------------------------------------------------------------------ templates
//
// A template compiles to a flat op list (a tiny bytecode), interpreted by
// renderOps. Op kinds: 0 text, 1 {{ path }} escaped, 2 {{{ path }}} raw,
// 3 for, 4 endfor, 5 if, 6 else, 7 endif, 8 include.
//   for:     [3, varName, pathParts, endforIndex]
//   if:      [5, pathParts, negated, elseIndex(-1), endifIndex]
//   else:    [6, endifIndex]   (patched when the endif is found)
//   include: [8, name]

const T_TEXT = 0;
const T_VAR = 1;
const T_RAW = 2;
const T_FOR = 3;
const T_ENDFOR = 4;
const T_IF = 5;
const T_ELSE = 6;
const T_ENDIF = 7;
const T_INCLUDE = 8;

function isName(s) {
  if (s === '') return false;
  const c0 = s.charCodeAt(0);
  if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122) || c0 === 95)) return false;
  for (let i = 1; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95)) return false;
  }
  return true;
}

/** A path is names joined by '.', or null when it is not one. */
function parsePath(s) {
  if (s === '') return null;
  const parts = s.split('.');
  for (let k = 0; k < parts.length; k++) if (!isName(parts[k])) return null;
  return parts;
}

/** One {% %} tag. Returns { op } or { error }. */
function parseTag(inner) {
  if (inner === 'else') return { op: [T_ELSE, -1] };
  if (inner === 'endif') return { op: [T_ENDIF] };
  if (inner === 'endfor') return { op: [T_ENDFOR] };
  let m = /^include\s+"([^"]*)"$/.exec(inner);
  if (m) return { op: [T_INCLUDE, m[1]] };
  m = /^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+(.+)$/.exec(inner);
  if (m) {
    const path = parsePath(m[2].trim());
    if (!path) return { error: `"${m[2].trim()}" is not a path` };
    return { op: [T_FOR, m[1], path, -1] };
  }
  m = /^if\s+(not\s+)?(.+)$/.exec(inner);
  if (m) {
    const path = parsePath(m[2].trim());
    if (!path) return { error: `"${m[2].trim()}" is not a path` };
    return { op: [T_IF, path, m[1] !== undefined, -1, -1] };
  }
  return { error: `{% ${inner} %} is not a tag` };
}

/**
 * Compile a template source. Returns { ops } or { error }.
 * A {% %} tag alone on its line (only spaces or tabs beside it) takes the
 * whole line with it, its \n included. Text, {{ }} and {{{ }}} never do.
 */
function compileTemplate(src) {
  const ops = [];
  const stack = [];
  let text = '';
  let i = 0;
  const n = src.length;
  const flush = () => {
    if (text !== '') { ops.push([T_TEXT, text]); text = ''; }
  };
  while (i < n) {
    if (src[i] === '{' && (src[i + 1] === '{' || src[i + 1] === '%')) {
      if (src[i + 1] === '{') {
        const raw = src[i + 2] === '{';
        const close = raw ? '}}}' : '}}';
        const j = src.indexOf(close, i + (raw ? 3 : 2));
        if (j === -1) return { error: raw ? 'a {{{ is not closed' : 'a {{ is not closed' };
        const inner = src.slice(i + (raw ? 3 : 2), j).trim();
        const path = parsePath(inner);
        if (!path) return { error: `"${inner}" is not a path` };
        flush();
        ops.push([raw ? T_RAW : T_VAR, path]);
        i = j + close.length;
        continue;
      }
      const j = src.indexOf('%}', i + 2);
      if (j === -1) return { error: 'a {% is not closed' };
      const inner = src.slice(i + 2, j).trim();
      // Standalone? The pending text since the last \n must be spaces/tabs
      // only, and so must the source from the tag's end to the next \n.
      let standalone = false;
      let lineStart = -1;
      const li = text.lastIndexOf('\n');
      const tail = li === -1 ? text : text.slice(li + 1);
      let allSpace = true;
      for (let k = 0; k < tail.length; k++) {
        const cc = tail.charCodeAt(k);
        if (cc !== 32 && cc !== 9) { allSpace = false; break; }
      }
      if (allSpace) {
        let k = j + 2;
        let ok = true;
        while (k < n && src[k] !== '\n') {
          const cc = src.charCodeAt(k);
          if (cc !== 32 && cc !== 9) { ok = false; break; }
          k++;
        }
        if (ok) { standalone = true; lineStart = li; }
      }
      const parsed = parseTag(inner);
      if (parsed.error) return parsed;
      const op = parsed.op;
      if (standalone) {
        text = lineStart === -1 ? '' : text.slice(0, lineStart + 1);
        let k = j + 2;
        while (k < n && src[k] !== '\n') k++;
        i = k < n ? k + 1 : k;
      } else {
        i = j + 2;
      }
      flush();
      if (op[0] === T_FOR) {
        stack.push({ kind: 'for', idx: ops.length });
        ops.push(op);
      } else if (op[0] === T_IF) {
        stack.push({ kind: 'if', idx: ops.length });
        ops.push(op);
      } else if (op[0] === T_ELSE) {
        const s = stack[stack.length - 1];
        if (!s || s.kind !== 'if' || s.hasElse) return { error: 'an else outside an if' };
        s.hasElse = true;
        ops[s.idx][3] = ops.length;
        ops.push(op);
      } else if (op[0] === T_ENDIF) {
        const s = stack[stack.length - 1];
        if (!s || s.kind !== 'if') return { error: 'an endif with no open if' };
        stack.pop();
        ops[s.idx][4] = ops.length;
        const elseIdx = ops[s.idx][3];
        if (elseIdx !== -1) ops[elseIdx][1] = ops.length;
        ops.push(op);
      } else if (op[0] === T_ENDFOR) {
        const s = stack[stack.length - 1];
        if (!s || s.kind !== 'for') return { error: 'an endfor with no open for' };
        stack.pop();
        ops[s.idx][3] = ops.length;
        ops.push(op);
      } else {
        ops.push(op);
      }
      continue;
    }
    text += src[i];
    i++;
  }
  flush();
  if (stack.length > 0) {
    const top = stack[stack.length - 1];
    return { error: top.kind === 'for' ? 'a for is not closed' : 'a if is not closed' };
  }
  return { ops };
}

// ------------------------------------------------------------------ template values

function truthy(v) {
  if (v === undefined || v === null || v === false || v === '' || v === 0) return false;
  if (Array.isArray(v)) return v.length !== 0;
  return true;
}

/** A value as a template writes it. */
function writeValue(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) {
    let s = '';
    for (let k = 0; k < v.length; k++) {
      if (k > 0) s += ', ';
      s += writeValue(v[k]);
    }
    return s;
  }
  return '';
}

const HAS_OWN = Object.prototype.hasOwnProperty;

/**
 * A path's first name is read from the innermost loop that binds it
 * (loop before the element), else from the page's values; each next name
 * is an own property of the value so far, or the path is undefined.
 */
function resolvePath(ctx, scope, parts) {
  const first = parts[0];
  let v;
  let found = false;
  for (let s = scope.length - 1; s >= 0; s--) {
    const f = scope[s];
    if (first === 'loop') { v = f.loop; found = true; break; }
    if (first === f.name) { v = f.arr[f.idx]; found = true; break; }
  }
  if (!found) {
    if (HAS_OWN.call(ctx, first)) { v = ctx[first]; found = true; }
    else return undefined;
  }
  for (let k = 1; k < parts.length; k++) {
    if (v === null || v === undefined) return undefined;
    const p = parts[k];
    if (!HAS_OWN.call(v, p)) return undefined;
    v = v[p];
  }
  return v;
}

/**
 * Render compiled ops into out (an array of strings). scope is the loop
 * frame stack (shared with includes, which render in the same scope).
 * depth is the include depth: a missing template, or one nested more than
 * 8 deep, renders nothing.
 */
function renderOps(ops, ctx, scope, depth, templates, out) {
  let pc = 0;
  const n = ops.length;
  while (pc < n) {
    const op = ops[pc];
    switch (op[0]) {
      case T_TEXT:
        out.push(op[1]);
        pc++;
        break;
      case T_VAR:
        out.push(esc(writeValue(resolvePath(ctx, scope, op[1]))));
        pc++;
        break;
      case T_RAW:
        out.push(writeValue(resolvePath(ctx, scope, op[1])));
        pc++;
        break;
      case T_FOR: {
        const v = resolvePath(ctx, scope, op[2]);
        if (Array.isArray(v) && v.length > 0) {
          scope.push({
            name: op[1], arr: v, idx: 0, bodyStart: pc + 1,
            loop: { index: 1, first: true, last: v.length === 1, length: v.length },
          });
          pc++;
        } else {
          pc = op[3] + 1;
        }
        break;
      }
      case T_ENDFOR: {
        const f = scope[scope.length - 1];
        f.idx++;
        if (f.idx < f.arr.length) {
          f.loop.index = f.idx + 1;
          f.loop.first = false;
          f.loop.last = f.idx === f.arr.length - 1;
          pc = f.bodyStart;
        } else {
          scope.pop();
          pc++;
        }
        break;
      }
      case T_IF: {
        const v = resolvePath(ctx, scope, op[1]);
        const t = truthy(v);
        const cond = op[2] ? !t : t;
        if (cond) pc++;
        else pc = op[3] !== -1 ? op[3] + 1 : op[4] + 1;
        break;
      }
      case T_ELSE:
        pc = op[1] + 1;
        break;
      case T_ENDIF:
        pc++;
        break;
      case T_INCLUDE: {
        const tpl = templates.get(op[1]);
        if (tpl !== undefined && depth + 1 <= 8) {
          renderOps(tpl, ctx, scope, depth + 1, templates, out);
        }
        pc++;
        break;
      }
      default:
        pc++;
        break;
    }
  }
}

/** Render a compiled template to a string. */
function renderTemplate(ops, ctx, templates) {
  const out = [];
  renderOps(ops, ctx, [], 0, templates, out);
  return out.join('');
}

// ------------------------------------------------------------------ markdown
//
// The body is read line by line. Blocks, in order, each followed by \n.
// Inline, left to right, with a recursive descent over the openers.

function isFenceStart(line) {
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return null;
  let k = 3;
  let lang = '';
  while (k < line.length) {
    const c = line.charCodeAt(k);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 43 || c === 45) {
      lang += line[k];
      k++;
    } else break;
  }
  while (k < line.length) {
    const c = line.charCodeAt(k);
    if (c !== 32 && c !== 9) return null;
    k++;
  }
  return lang;
}

function isFenceClose(line) {
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return false;
  for (let k = 3; k < line.length; k++) {
    const c = line.charCodeAt(k);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function headingOf(line) {
  let h = 0;
  while (h < line.length && line.charCodeAt(h) === 35) h++;
  if (h === 0 || h > 6 || h >= line.length) return null;
  const c = line.charCodeAt(h);
  if (c !== 32 && c !== 9) return null;
  const text = trimEndST(line.slice(h + 1));
  if (text === '') return null;
  return { level: h, text };
}

function isBreak(line) {
  let e = line.length;
  while (e > 0) {
    const c = line.charCodeAt(e - 1);
    if (c === 32 || c === 9) e--;
    else break;
  }
  if (e !== 3) return false;
  return (line.charCodeAt(0) === 45 && line.charCodeAt(1) === 45 && line.charCodeAt(2) === 45) ||
    (line.charCodeAt(0) === 42 && line.charCodeAt(1) === 42 && line.charCodeAt(2) === 42);
}

/** Split a body into lines, counting its words (runs of characters other
 *  than whitespace) in the same pass. */
function splitLines(body) {
  const lines = [];
  let start = 0;
  let words = 0;
  let inWord = false;
  for (let i = 0; i < body.length; i++) {
    const c = body.charCodeAt(i);
    if (c === 10) {
      lines.push(body.slice(start, i));
      start = i + 1;
      inWord = false;
    } else if (c <= 32 || c === 0xA0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200A) ||
      c === 0x2028 || c === 0x2029 || c === 0x202F || c === 0x205F || c === 0x3000 || c === 0xFEFF) {
      inWord = false;
    } else if (!inWord) {
      inWord = true;
      words++;
    }
  }
  lines.push(body.slice(start));
  return { lines, words };
}

/** A list marker: { ordered, len, num } or null. '-' and '*' are one kind. */
function listMarker(line) {
  const c0 = line.charCodeAt(0);
  if (c0 === 45 || c0 === 42) {
    if (line.charCodeAt(1) === 32) return { ordered: false, len: 2, num: 0 };
    return null;
  }
  if (c0 >= 48 && c0 <= 57) {
    let k = 0;
    let num = 0;
    while (k < line.length) {
      const c = line.charCodeAt(k);
      if (c < 48 || c > 57) break;
      num = num * 10 + (c - 48);
      k++;
    }
    if (line.charCodeAt(k) === 46 && line.charCodeAt(k + 1) === 32) {
      return { ordered: true, len: k + 2, num };
    }
    return null;
  }
  return null;
}

// Inline scanning. The closers are found by a flat scan, not by a
// recursive descent: a strong is closed by the next '**' (an escaped
// '\*' is skipped), an emphasis by the next single '*' (an escaped '\*'
// is skipped, and a '**' pair is skipped as a pair). The content between
// an opener and its closer is itself rendered inline.
function findStrongCloser(s, i, end) {
  let j = i;
  while (j < end) {
    if (s.charCodeAt(j) === 92 && j + 1 < end && ESCAPABLE.indexOf(s[j + 1]) !== -1) { j += 2; continue; }
    if (s.charCodeAt(j) === 42 && s.charCodeAt(j + 1) === 42) return j;
    j++;
  }
  return -1;
}

function findEmCloser(s, i, end) {
  let j = i;
  while (j < end) {
    if (s.charCodeAt(j) === 92 && j + 1 < end && ESCAPABLE.indexOf(s[j + 1]) !== -1) { j += 2; continue; }
    if (s.charCodeAt(j) === 42) {
      if (s.charCodeAt(j + 1) === 42) { j += 2; continue; }
      return j;
    }
    j++;
  }
  return -1;
}

/** Inline rendering of s[i..end). Plain runs are appended as one slice. */
function inline(s, i, end, link) {
  let out = '';
  let run = i;
  while (i < end) {
    const c = s.charCodeAt(i);
    if (c === 92) {
      // A backslash before one of \ ` * _ [ ] ( ) # + - . ! > writes that
      // character; any other backslash is itself.
      const nx = i + 1 < end ? s[i + 1] : '';
      if (nx !== '' && ESCAPABLE.indexOf(nx) !== -1) {
        out += s.slice(run, i) + nx;
        i += 2;
      } else {
        out += s.slice(run, i) + '\\';
        i++;
      }
      run = i;
      continue;
    }
    if (c === 96) {
      // A code span: a backtick closed by the next backtick, with at least
      // one character between. A backtick with no closer is itself.
      const j = s.indexOf('`', i + 1);
      if (j !== -1 && j > i + 1 && j < end) {
        out += s.slice(run, i) + '<code>' + esc(s.slice(i + 1, j)) + '</code>';
        i = j + 1;
      } else {
        out += s.slice(run, i) + '`';
        i++;
      }
      run = i;
      continue;
    }
    if (c === 42) {
      if (s.charCodeAt(i + 1) === 42) {
        const j = findStrongCloser(s, i + 2, end);
        if (j !== -1 && j > i + 2) {
          out += s.slice(run, i) + '<strong>' + inline(s, i + 2, j, link) + '</strong>';
          i = j + 2;
        } else {
          out += s.slice(run, i) + '**';
          i += 2;
        }
      } else {
        const j = findEmCloser(s, i + 1, end);
        if (j !== -1) {
          out += s.slice(run, i) + '<em>' + inline(s, i + 1, j, link) + '</em>';
          i = j + 1;
        } else {
          out += s.slice(run, i) + '*';
          i++;
        }
      }
      run = i;
      continue;
    }
    if (c === 91) {
      const r = tryLink(s, i, end, link);
      if (r !== null) {
        out += s.slice(run, i) + r[0];
        i = r[1];
      } else {
        out += s.slice(run, i) + '[';
        i++;
      }
      run = i;
      continue;
    }
    if (c === 38 || c === 60 || c === 62 || c === 34 || c === 39) {
      out += s.slice(run, i);
      out += c === 38 ? '&amp;' : c === 60 ? '&lt;' : c === 62 ? '&gt;' : c === 34 ? '&quot;' : '&#39;';
      i++;
      run = i;
      continue;
    }
    i++;
  }
  out += s.slice(run, end);
  return out;
}

/**
 * [text](target): the first ] not escaped closes the text, ( must follow
 * at once, and the next ) closes the target, which must not be empty or
 * hold whitespace. Else [ is itself. Returns [html, pos] or null.
 */
function tryLink(s, i, end, link) {
  let j = i + 1;
  while (j < end) {
    const c = s.charCodeAt(j);
    if (c === 92) { j += 2; continue; }
    if (c === 93) break;
    j++;
  }
  if (j >= end) return null;
  if (j + 1 >= end || s.charCodeAt(j + 1) !== 40) return null;
  const k = s.indexOf(')', j + 2);
  if (k === -1 || k >= end) return null;
  const target = s.slice(j + 2, k);
  if (target === '') return null;
  for (let t = 0; t < target.length; t++) {
    const c = target.charCodeAt(t);
    if (c === 32 || c === 9 || c === 10 || c === 13) return null;
  }
  const textHtml = inline(s, i + 1, j, link);
  const href = link(target);
  return ['<a href="' + esc(href) + '">' + textHtml + '</a>', k + 1];
}

/** True when the line starts a fence, a heading or a thematic break (the
 *  things that end a paragraph). The line is known non-blank. */
function paraStop(line) {
  const c0 = line.charCodeAt(0);
  if (c0 === 96) return isFenceStart(line) !== null;
  if (c0 === 35) return headingOf(line) !== null;
  if (c0 === 45 || c0 === 42) return isBreak(line);
  return false;
}

/**
 * Render one body to HTML. link(target) resolves a link target to its href.
 * Returns { html, excerpt, toc, words }: excerpt is the HTML of the body's
 * first paragraph (or ''), toc the level 2 and 3 headings ({ level, id, html }),
 * words the body's word count.
 */
function renderMarkdown(body, link, slug) {
  const { lines, words } = splitLines(body);
  const out = [];
  let excerpt = '';
  let excerptSet = false;
  const toc = [];
  const headingIds = new Set();
  let i = 0;
  const n = lines.length;

  // A list starting at lines[i] with marker mk. Returns the next index.
  const doList = (mk) => {
    const ordered = mk.ordered;
    const startNum = mk.num;
    const items = [];
    while (i < n) {
      const l = lines[i];
      if (isBlank(l)) break;
      const m2 = listMarker(l);
      if (m2 !== null && m2.ordered === ordered) {
        items.push(l.slice(m2.len));
        i++;
        continue;
      }
      let sp = 0;
      while (sp < l.length && (l.charCodeAt(sp) === 32 || l.charCodeAt(sp) === 9)) sp++;
      if (sp >= 2 && sp < l.length) {
        items[items.length - 1] += '\n' + trimST(l);
        i++;
        continue;
      }
      break;
    }
    out.push(ordered
      ? (startNum !== 1 ? '<ol start="' + startNum + '">\n' : '<ol>\n')
      : '<ul>\n');
    for (let k = 0; k < items.length; k++) {
      const it = items[k];
      out.push('<li>' + inline(it, 0, it.length, link) + '</li>\n');
    }
    out.push(ordered ? '</ol>\n' : '</ul>\n');
  };

  while (i < n) {
    const line = lines[i];
    if (line.length === 0) { i++; continue; }
    const c0 = line.charCodeAt(0);
    if (c0 === 32 || c0 === 9) {
      if (isBlank(line)) { i++; continue; }
    } else if (c0 === 96) {
      const lang = isFenceStart(line);
      if (lang !== null) {
        const buf = [];
        i++;
        while (i < n) {
          const l = lines[i];
          if (isFenceClose(l)) break;
          buf.push(esc(l));
          i++;
        }
        if (i < n) i++; // the closing line
        out.push('<pre><code' + (lang !== '' ? ' class="language-' + lang + '"' : '') +
          '>' + buf.join('\n') + '\n</code></pre>\n');
        continue;
      }
    } else if (c0 === 35) {
      const hd = headingOf(line);
      if (hd !== null) {
        const base = slug(hd.text);
        let id = base;
        if (headingIds.has(id)) {
          let k = 2;
          while (headingIds.has(base + '-' + k)) k++;
          id = base + '-' + k;
        }
        headingIds.add(id);
        const html = inline(hd.text, 0, hd.text.length, link);
        if (hd.level === 2 || hd.level === 3) toc.push({ level: hd.level, id, html });
        out.push('<h' + hd.level + ' id="' + id + '">' + html + '</h' + hd.level + '>\n');
        i++;
        continue;
      }
    } else if (c0 === 45 || c0 === 42) {
      if (isBreak(line)) {
        out.push('<hr>\n');
        i++;
        continue;
      }
      const mk = listMarker(line);
      if (mk !== null) {
        doList(mk);
        continue;
      }
    } else if (c0 === 62) {
      const parts = [];
      while (i < n) {
        const l = lines[i];
        if (l.charCodeAt(0) !== 62) break;
        let t = l.slice(1);
        if (t.charCodeAt(0) === 32) t = t.slice(1);
        t = trimST(t);
        if (t !== '') parts.push(t);
        i++;
      }
      const joined = parts.join('\n');
      out.push('<blockquote>\n' +
        (parts.length > 0
          ? '<p>' + inline(joined, 0, joined.length, link) + '</p>\n'
          : '') +
        '</blockquote>\n');
      continue;
    } else if (c0 >= 48 && c0 <= 57) {
      const mk = listMarker(line);
      if (mk !== null) {
        doList(mk);
        continue;
      }
    }
    // A paragraph: this line and the lines after it up to a blank line, a
    // fence, a heading or a thematic break.
    const parts = [];
    while (i < n) {
      const l = lines[i];
      if (isBlank(l)) break;
      if (paraStop(l)) break;
      parts.push(trimST(l));
      i++;
    }
    const joined = parts.join('\n');
    const html = inline(joined, 0, joined.length, link);
    if (!excerptSet) {
      excerpt = html;
      excerptSet = true;
    }
    out.push('<p>' + html + '</p>\n');
  }
  return { html: out.join(''), excerpt, toc, words };
}

// ------------------------------------------------------------------ the build

function dirOf(path) {
  const k = path.lastIndexOf('/');
  return k === -1 ? '' : path.slice(0, k);
}

/** Resolve a relative link target from a source's directory ('.' and '..'
 *  steps, never above the root). */
function resolveRel(dir, path) {
  const out = dir === '' ? [] : dir.split('/');
  const parts = path.split('/');
  for (let k = 0; k < parts.length; k++) {
    const p = parts[k];
    if (p === '' || p === '.') continue;
    if (p === '..') {
      if (out.length > 0) out.pop();
      continue;
    }
    out.push(p);
  }
  return out.join('/');
}

function isScheme(target) {
  const colon = target.indexOf(':');
  if (colon <= 0) return false;
  const s = target.slice(0, colon);
  const c0 = s.charCodeAt(0);
  if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122))) return false;
  for (let i = 1; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) ||
      c === 43 || c === 45 || c === 46)) return false;
  }
  return true;
}

/** makefun-site 1.0.0's answer for one case's input. */
export function run(input) {
  const site = input.site || {};
  const templatesIn = input.templates || {};
  const files = input.files || [];
  let base = site.base_url || '';
  while (base.endsWith('/')) base = base.slice(0, -1);
  const perPage = typeof site.per_page === 'number' && site.per_page > 0 ? site.per_page : 10;

  // Slugs are memoised per case: titles and headings repeat a lot.
  const slugCache = new Map();
  const slug = (s) => {
    let v = slugCache.get(s);
    if (v === undefined) {
      v = slugifyRaw(s);
      slugCache.set(s, v);
    }
    return v;
  };

  const report = [];
  const brokenSeen = new Set();
  const reportBroken = (sourcePath, target) => {
    const line = `broken-link ${sourcePath} -> ${target}`;
    if (!brokenSeen.has(line)) {
      brokenSeen.add(line);
      report.push(line);
    }
  };

  // Templates: parsed in code-unit order of name. One that does not parse
  // is reported and left out, as if it were not there.
  const templates = new Map();
  const names = Object.keys(templatesIn).sort();
  for (let k = 0; k < names.length; k++) {
    const name = names[k];
    const compiled = compileTemplate(templatesIn[name]);
    if (compiled.error) report.push(`template "${name}": ${compiled.error}`);
    else templates.set(name, compiled.ops);
  }

  // Sources, sorted by path in code-unit order, whatever order they arrive in.
  const sorted = files.slice().sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const pages = [];
  const statics = [];
  const dirTaken = new Map();
  const takeSlug = (dir, baseSlug) => {
    let taken = dirTaken.get(dir);
    if (taken === undefined) {
      taken = new Set();
      if (dir === '') {
        taken.add('posts');
        taken.add('tags');
        taken.add('page');
      }
      dirTaken.set(dir, taken);
    }
    let s = baseSlug;
    if (taken.has(s)) {
      let k = 2;
      while (taken.has(s + '-' + k)) k++;
      s = s + '-' + k;
    }
    taken.add(s);
    return s;
  };

  for (let fi = 0; fi < sorted.length; fi++) {
    const file = sorted[fi];
    const path = file.path;
    if (!path.endsWith('.md')) {
      statics.push(file);
      continue;
    }
    const content = String(file.content).replace(/\r\n?/g, '\n');
    const parsed = parseFrontMatter(content);
    if (parsed.error) {
      report.push(`refused ${path}: ${parsed.error}`);
      continue;
    }
    const meta = parsed.fm;
    const isPost = path.startsWith('posts/');
    if (path.startsWith('tags/')) {
      report.push(`refused ${path}: tags/ is the generator's own`);
      continue;
    }
    if (path.startsWith('page/')) {
      report.push(`refused ${path}: page/ is the generator's own`);
      continue;
    }
    if (isPost && meta.date === undefined) {
      report.push(`refused ${path}: a post needs a date`);
      continue;
    }
    const layout = meta.layout !== undefined ? meta.layout : (isPost ? 'post' : 'page');
    if (!templates.has(layout)) {
      report.push(`refused ${path}: layout "${layout}" is no template that parses`);
      continue;
    }
    if (meta.draft === true) {
      report.push(`draft ${path}`);
      continue;
    }
    const dir = isPost ? 'posts' : dirOf(path);
    const baseSlug = meta.slug !== undefined ? meta.slug : slug(meta.title);
    const slugVal = takeSlug(dir, baseSlug);
    pages.push({
      path,
      sourceDir: dirOf(path),
      dir,
      slug: slugVal,
      isPost,
      date: meta.date !== undefined ? meta.date : '',
      title: meta.title,
      summary: meta.summary !== undefined ? meta.summary : '',
      tagsRaw: meta.tags !== undefined ? meta.tags : [],
      layout,
      body: parsed.body,
      url: base + '/' + (dir !== '' ? dir + '/' : '') + slugVal + '/',
    });
  }

  // Link targets: a built page's source path, or a static file's path.
  const pageBySource = new Map();
  for (let k = 0; k < pages.length; k++) pageBySource.set(pages[k].path, pages[k].url);
  const staticSet = new Set();
  for (let k = 0; k < statics.length; k++) staticSet.add(statics[k].path);

  // Collections: the posts, newest date first, equal dates by slug.
  const posts = pages.filter((p) => p.isPost);
  posts.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    if (a.slug !== b.slug) return a.slug < b.slug ? -1 : 1;
    return a.path < b.path ? -1 : 1;
  });

  // Tags: each post's tags, each slug once (the first spelling kept), in
  // its own order; a tag is named as it is first met walking the posts in
  // collection order. Ordered by count of posts, most first, then by slug.
  const tagMap = new Map();
  for (let pi = 0; pi < posts.length; pi++) {
    const post = posts[pi];
    const seen = new Set();
    const names = [];
    for (let ti = 0; ti < post.tagsRaw.length; ti++) {
      const name = post.tagsRaw[ti];
      const s = slug(name);
      if (seen.has(s)) continue;
      seen.add(s);
      names.push(name);
      let t = tagMap.get(s);
      if (t === undefined) {
        t = { name, slug: s, count: 0, posts: [] };
        tagMap.set(s, t);
      }
      t.count++;
      t.posts.push(post);
    }
    post.tagNames = names;
  }
  const tagsCtx = [...tagMap.values()]
    .sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      return a.slug < b.slug ? -1 : 1;
    })
    .map((t) => {
      t.url = base + '/tags/' + t.slug + '/';
      return { name: t.name, slug: t.slug, url: t.url, count: t.count };
    });
  // Every page's tags, each slug once, linking to the tag of the same slug
  // (or the url '' where no post has that tag).
  for (let k = 0; k < pages.length; k++) {
    const page = pages[k];
    if (page.isPost && page.tagNames === undefined) page.tagNames = page.tagsRaw;
    const seen = new Set();
    const list = [];
    const raw = page.isPost ? page.tagNames : page.tagsRaw;
    for (let ti = 0; ti < raw.length; ti++) {
      const name = raw[ti];
      const s = slug(name);
      if (seen.has(s)) continue;
      seen.add(s);
      // A page's tags are named as the tag is first met walking the posts
      // in collection order; where no post has that tag, its own spelling.
      const t = tagMap.get(s);
      list.push({ name: t !== undefined ? t.name : name, slug: s, url: t !== undefined ? t.url : '' });
    }
    page.tags = list;
  }

  // Markdown, each source's body rendered to HTML, its links resolved.
  for (let k = 0; k < pages.length; k++) {
    const page = pages[k];
    const link = (target) => {
      if (target.charCodeAt(0) === 35 || target.charCodeAt(0) === 47) return target;
      if (isScheme(target)) return target;
      let pathPart = target;
      let frag = '';
      const hi = target.indexOf('#');
      if (hi !== -1) {
        pathPart = target.slice(0, hi);
        frag = target.slice(hi);
      }
      const resolved = resolveRel(page.sourceDir, pathPart);
      const url = pageBySource.get(resolved);
      if (url !== undefined) return url + frag;
      if (staticSet.has(resolved)) return base + '/' + resolved + frag;
      reportBroken(page.path, target);
      return target;
    };
    const rendered = renderMarkdown(page.body, link, slug);
    page.content = rendered.html;
    page.excerpt = rendered.excerpt;
    page.toc = rendered.toc;
    page.readingMinutes = Math.max(1, Math.ceil(rendered.words / 200));
  }

  // Cards, neighbours, and the page objects the templates see.
  const cardOf = (page) => ({
    title: page.title,
    url: page.url,
    date: page.date,
    date_long: dateLong(page.date),
    summary: page.summary,
    excerpt: page.excerpt,
    reading_minutes: page.readingMinutes,
    tags: page.tags,
  });
  for (let k = 0; k < posts.length; k++) {
    posts[k].card = cardOf(posts[k]);
    posts[k].newer = null;
    posts[k].older = null;
  }
  for (let k = 0; k < posts.length; k++) {
    const post = posts[k];
    if (k > 0) {
      const nb = posts[k - 1];
      post.newer = { title: nb.title, url: nb.url, date: nb.date, date_long: dateLong(nb.date) };
    }
    if (k < posts.length - 1) {
      const nb = posts[k + 1];
      post.older = { title: nb.title, url: nb.url, date: nb.date, date_long: dateLong(nb.date) };
    }
  }
  const recent = posts.slice(0, site.recent).map((p) => p.card);
  const siteCtx = { title: site.title, base_url: base };

  const out = Object.create(null);
  let builtPages = 0;
  let builtPosts = 0;

  // Layouts: every page through its layout.
  for (let k = 0; k < pages.length; k++) {
    const page = pages[k];
    const ops = templates.get(page.layout);
    const ctx = {
      site: siteCtx,
      tags: tagsCtx,
      recent,
      page: {
        title: page.title,
        url: page.url,
        date: page.date,
        date_long: dateLong(page.date),
        summary: page.summary,
        excerpt: page.excerpt,
        reading_minutes: page.readingMinutes,
        tags: page.tags,
        slug: page.slug,
        content: page.content,
        toc: page.toc,
        newer: page.isPost ? page.newer : null,
        older: page.isPost ? page.older : null,
        is_post: page.isPost,
      },
    };
    out[(page.dir !== '' ? page.dir + '/' : '') + page.slug + '/index.html'] =
      renderTemplate(ops, ctx, templates);
    if (page.isPost) builtPosts++;
    else builtPages++;
  }

  // The index through 'index', per_page posts a page (at least one, even
  // with no posts). Each tag through 'tag', and tags/index.html through 'tags'.
  const indexOps = templates.get('index');
  if (indexOps !== undefined) {
    const total = Math.max(1, Math.ceil(posts.length / perPage));
    for (let pg = 1; pg <= total; pg++) {
      const slice = posts.slice((pg - 1) * perPage, pg * perPage);
      const url = pg === 1 ? base + '/' : base + '/page/' + pg + '/';
      const pager = {
        number: pg,
        total,
        url,
        newer_url: pg > 1 ? (pg - 1 === 1 ? base + '/' : base + '/page/' + (pg - 1) + '/') : '',
        older_url: pg < total ? base + '/page/' + (pg + 1) + '/' : '',
      };
      const ctx = {
        site: siteCtx,
        tags: tagsCtx,
        recent,
        posts: slice.map((p) => p.card),
        pager,
      };
      out[pg === 1 ? 'index.html' : 'page/' + pg + '/index.html'] =
        renderTemplate(indexOps, ctx, templates);
    }
  }
  const tagOps = templates.get('tag');
  if (tagOps !== undefined) {
    for (let ti = 0; ti < tagsCtx.length; ti++) {
      const t = tagsCtx[ti];
      const full = tagMap.get(t.slug);
      const ctx = {
        site: siteCtx,
        tags: tagsCtx,
        recent,
        tag: {
          name: t.name,
          slug: t.slug,
          url: t.url,
          count: t.count,
          posts: full.posts.map((p) => p.card),
        },
      };
      out['tags/' + t.slug + '/index.html'] = renderTemplate(tagOps, ctx, templates);
    }
  }
  const tagsOps = templates.get('tags');
  if (tagsOps !== undefined) {
    out['tags/index.html'] = renderTemplate(tagsOps, { site: siteCtx, tags: tagsCtx, recent }, templates);
  }

  // Static files at their own path, unless a built page has that path.
  for (let k = 0; k < statics.length; k++) {
    const f = statics[k];
    if (Object.prototype.hasOwnProperty.call(out, f.path)) {
      report.push(`shadowed ${f.path}: a built page has its path`);
    } else {
      out[f.path] = f.content;
    }
  }

  // The report: every line reported above, sorted in code-unit order, then
  // the built line, every line ending in \n.
  report.sort();
  report.push(`built ${builtPages} pages, ${builtPosts} posts, ${tagsCtx.length} tags and ${statics.length} static files`);
  out['build-report.txt'] = report.join('\n') + '\n';
  return out;
}
