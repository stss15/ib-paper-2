// State management
const state = {
  exams: [],
  questions: [], // Array of { number, text, subQuestions: [{letter, text, marks, isCoding}], code }
  currentQuestion: null,
  currentSubQuestion: null,
  answers: {}, // keyed by "questionNumber-letter"
  theme: 'dark',
  examCode: '',
};

let codeAnswerEditor = null;
let examCodeEditor = null;

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initEditors();
  wireEvents();
  loadManifest();
});

// ============== THEME ==============
function initTheme() {
  const stored = localStorage.getItem('ibp2-theme') || 'dark';
  applyTheme(stored);
}

function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('ibp2-theme', theme);
  
  const icon = document.querySelector('.theme-icon');
  if (icon) icon.textContent = theme === 'dark' ? '☀' : '◐';
  
  const cmTheme = theme === 'dark' ? 'dracula' : 'default';
  if (examCodeEditor) examCodeEditor.setOption('theme', cmTheme);
  if (codeAnswerEditor) codeAnswerEditor.setOption('theme', cmTheme);
}

// ============== EDITORS ==============
function initEditors() {
  const cmTheme = state.theme === 'dark' ? 'dracula' : 'default';
  
  // Exam code editor (read-only)
  examCodeEditor = CodeMirror.fromTextArea(document.getElementById('examCode'), {
    mode: 'text/x-java',
    theme: cmTheme,
    lineNumbers: true,
    readOnly: true,
    tabSize: 4,
    indentUnit: 4,
    lineWrapping: false,
  });
  
  // Answer code editor
  codeAnswerEditor = CodeMirror.fromTextArea(document.getElementById('codeAnswer'), {
    mode: 'text/x-java',
    theme: cmTheme,
    lineNumbers: true,
    tabSize: 4,
    indentUnit: 4,
    smartIndent: true,
    indentWithTabs: false,
    lineWrapping: false,
    extraKeys: {
      'Tab': (cm) => cm.execCommand('indentMore'),
      'Shift-Tab': (cm) => cm.execCommand('indentLess'),
    }
  });
}

// ============== EVENTS ==============
function wireEvents() {
  document.getElementById('themeToggle').addEventListener('click', () => {
    applyTheme(state.theme === 'dark' ? 'light' : 'dark');
  });
  
  document.getElementById('copyCode').addEventListener('click', () => {
    copyToClipboard(examCodeEditor.getValue());
  });
  
  document.getElementById('clearAnswer').addEventListener('click', clearCurrentAnswer);
  
  document.getElementById('revealMS').addEventListener('click', toggleMarkScheme);
}

function clearCurrentAnswer() {
  if (!state.currentSubQuestion) return;
  
  const key = `${state.currentQuestion.number}-${state.currentSubQuestion.letter}`;
  
  if (state.currentSubQuestion.isCoding) {
    codeAnswerEditor.setValue(state.currentSubQuestion.starterCode || '');
    state.answers[key] = state.currentSubQuestion.starterCode || '';
  } else {
    document.getElementById('textAnswer').value = '';
    state.answers[key] = '';
  }
}

function toggleMarkScheme() {
  const content = document.getElementById('markSchemeContent');
  const btn = document.getElementById('revealMS');
  const icon = btn.querySelector('.reveal-icon');
  
  if (content.classList.contains('hidden')) {
    content.classList.remove('hidden');
    icon.textContent = '▼';
    btn.querySelector('span:last-child') && (btn.innerHTML = '<span class="reveal-icon">▼</span> Hide Mark Scheme');
  } else {
    content.classList.add('hidden');
    icon.textContent = '▶';
    btn.innerHTML = '<span class="reveal-icon">▶</span> Click to Reveal Mark Scheme';
  }
}

// ============== DATA LOADING ==============
async function loadManifest() {
  try {
    const res = await fetch('exams.json');
    const exams = await res.json();
    state.exams = exams;
    populateExamSelect(exams);
    if (exams.length) {
      document.getElementById('examSelect').value = exams[exams.length - 1].id; // Start with newest
      await loadExam(exams[exams.length - 1].id);
    }
  } catch (err) {
    console.error('Failed to load manifest:', err);
  }
}

function populateExamSelect(exams) {
  const select = document.getElementById('examSelect');
  select.innerHTML = '';
  exams.forEach(exam => {
    const opt = document.createElement('option');
    opt.value = exam.id;
    opt.textContent = exam.label;
    select.appendChild(opt);
  });
  select.addEventListener('change', e => loadExam(e.target.value));
}

async function loadExam(examId) {
  const exam = state.exams.find(e => e.id === examId);
  if (!exam) return;
  
  state.answers = {};
  state.currentQuestion = null;
  state.currentSubQuestion = null;
  
  try {
    const [qpText, msText] = await Promise.all([
      fetch(exam.questionPath).then(r => r.text()),
      fetch(exam.markSchemePath).then(r => r.text()),
    ]);
    
    parseExam(qpText, msText);
    renderQuestionList();
    renderExamCode();
    clearAnswerPanel();
  } catch (err) {
    console.error('Failed to load exam:', err);
  }
}

// ============== PARSING ==============
function parseExam(qpText, msText) {
  // Extract Option D section
  const optionDText = extractOptionD(qpText);
  const optionDMS = extractOptionD(msText);
  
  // Extract all Java code from the exam
  state.examCode = extractAllJavaCode(optionDText);
  
  // Parse questions and sub-questions
  const rawQuestions = splitMainQuestions(optionDText);
  const rawMS = splitMainQuestions(optionDMS);
  
  // Create mark scheme map
  const msMap = new Map();
  rawMS.forEach(q => {
    const subMS = parseSubQuestions(q.text, true);
    subMS.forEach(sub => {
      msMap.set(`${q.number}-${sub.letter}`, sub);
    });
  });
  
  // Build final questions array
  state.questions = rawQuestions
    .filter(q => parseInt(q.number, 10) >= 10) // Option D starts at Q10
    .map(q => {
      const subQuestions = parseSubQuestions(q.text, false).map(sub => {
        const msKey = `${q.number}-${sub.letter}`;
        const ms = msMap.get(msKey);
        return {
          ...sub,
          markScheme: ms?.text || 'Mark scheme not available.',
          marks: ms?.marks || sub.marks,
          isCoding: detectCodingQuestion(sub.text),
          starterCode: extractMethodSignature(sub.text, state.examCode),
        };
      });
      
      return {
        number: q.number,
        text: q.text,
        subQuestions,
      };
    });
}

function extractOptionD(text) {
  const lower = text.toLowerCase();
  const start = lower.indexOf('option d');
  if (start === -1) return text;
  
  const end = lower.indexOf('end of option d', start);
  return end !== -1 ? text.slice(start, end) : text.slice(start);
}

function extractAllJavaCode(text) {
  const lines = text.split(/\r?\n/);
  const codeBlocks = [];
  let currentBlock = [];
  let inCode = false;
  
  const codeIndicators = [
    /^\s*(public|private|protected|class|interface|enum|import|package)\b/,
    /^\s*(static|void|int|double|boolean|String|char|float|long)\b/,
    /^\s*(if|else|for|while|do|switch|case|return|new|try|catch)\b/,
    /^\s*\/\//,
    /^\s*\/\*/,
    /^\s*\*/,
    /[{};]\s*$/,
    /^\s*[-+]\s+\w+.*:\s*\w+/,  // UML-like: - attributeName: Type
  ];
  
  for (const line of lines) {
    const trimmed = line.trim();
    const isCodeLine = codeIndicators.some(re => re.test(line)) || 
                       (inCode && (trimmed === '' || trimmed === '}' || trimmed === '{'));
    
    if (isCodeLine && trimmed.length > 0) {
      inCode = true;
      currentBlock.push(line);
    } else if (inCode && trimmed === '') {
      currentBlock.push('');
    } else {
      if (currentBlock.length > 3) {
        codeBlocks.push(currentBlock.join('\n'));
      }
      currentBlock = [];
      inCode = false;
    }
  }
  
  if (currentBlock.length > 3) {
    codeBlocks.push(currentBlock.join('\n'));
  }
  
  // Return the longest meaningful code block
  if (codeBlocks.length === 0) return '// No Java code provided in this exam.';
  
  // Combine all substantial code blocks
  const combined = codeBlocks
    .filter(block => block.split('\n').length > 2)
    .join('\n\n');
  
  return combined || '// No Java code provided in this exam.';
}

function splitMainQuestions(text) {
  const lines = text.split(/\r?\n/);
  const questions = [];
  let current = null;
  
  // Match lines that start with a number followed by period (e.g., "10.", "11.")
  const mainQPattern = /^(\d{1,2})\.\s*$/;
  
  for (const line of lines) {
    const match = line.match(mainQPattern);
    if (match) {
      if (current) questions.push(current);
      current = { number: match[1], lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  
  if (current) questions.push(current);
  
  return questions.map(q => ({
    number: q.number,
    text: q.lines.join('\n').trim(),
  }));
}

function parseSubQuestions(text, isMarkScheme) {
  const lines = text.split(/\r?\n/);
  const subs = [];
  let current = null;
  
  // Match (a), (b), (c), etc.
  const subPattern = /^\(([a-z])\)\s*/i;
  // Match marks like [2], [3 max], [8 max]
  const marksPattern = /\[(\d+)(?:\s*max)?\]/;
  
  for (const line of lines) {
    const match = line.match(subPattern);
    if (match) {
      if (current) subs.push(current);
      current = { letter: match[1].toLowerCase(), lines: [line.replace(subPattern, '').trim()] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  
  if (current) subs.push(current);
  
  return subs.map(sub => {
    const fullText = sub.lines.join('\n').trim();
    const marksMatch = fullText.match(marksPattern);
    return {
      letter: sub.letter,
      text: fullText,
      marks: marksMatch ? parseInt(marksMatch[1], 10) : null,
    };
  });
}

function detectCodingQuestion(text) {
  const codingKeywords = [
    /\bconstruct\b.*\bcode\b/i,
    /\bconstruct\b.*\bmethod\b/i,
    /\bwrite\b.*\bcode\b/i,
    /\bwrite\b.*\bmethod\b/i,
    /\bcreate\b.*\bmethod\b/i,
    /\bimplement\b/i,
    /\bclass\b.*\bcode\b/i,
  ];
  return codingKeywords.some(re => re.test(text));
}

function extractMethodSignature(questionText, examCode) {
  // Try to extract a relevant method signature for coding questions
  const methodMatch = questionText.match(/\b(get|set|find|calculate|add|remove|check|is|has)\w*\s*\(/i);
  if (methodMatch) {
    const methodName = methodMatch[0].replace('(', '').trim();
    // Search exam code for this method
    const codeLines = examCode.split('\n');
    for (let i = 0; i < codeLines.length; i++) {
      if (codeLines[i].includes(methodName)) {
        // Return surrounding context
        const start = Math.max(0, i - 2);
        const end = Math.min(codeLines.length, i + 5);
        return codeLines.slice(start, end).join('\n');
      }
    }
  }
  
  // Default starter for coding questions
  return '// Write your code here\n\n';
}

// ============== RENDERING ==============
function renderQuestionList() {
  const container = document.getElementById('questionList');
  container.innerHTML = '';
  
  state.questions.forEach(q => {
    const questionDiv = document.createElement('div');
    questionDiv.className = 'question-item';
    
    // Main question header (collapsible)
    const header = document.createElement('button');
    header.className = 'question-header';
    header.innerHTML = `
      <span class="q-number">Q${q.number}</span>
      <span class="q-expand">▶</span>
    `;
    header.addEventListener('click', () => toggleQuestionExpand(questionDiv, q));
    
    // Sub-questions container
    const subContainer = document.createElement('div');
    subContainer.className = 'sub-questions hidden';
    
    q.subQuestions.forEach(sub => {
      const subBtn = document.createElement('button');
      subBtn.className = 'sub-question-btn';
      subBtn.innerHTML = `
        <span class="sub-letter">(${sub.letter})</span>
        <span class="sub-preview">${truncate(sub.text, 60)}</span>
        ${sub.marks ? `<span class="sub-marks">[${sub.marks}]</span>` : ''}
        ${sub.isCoding ? '<span class="code-badge">CODE</span>' : ''}
      `;
      subBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        selectSubQuestion(q, sub, subBtn);
      });
      subContainer.appendChild(subBtn);
    });
    
    questionDiv.appendChild(header);
    questionDiv.appendChild(subContainer);
    container.appendChild(questionDiv);
  });
}

function toggleQuestionExpand(questionDiv, q) {
  const subContainer = questionDiv.querySelector('.sub-questions');
  const expandIcon = questionDiv.querySelector('.q-expand');
  const isExpanded = !subContainer.classList.contains('hidden');
  
  // Close all others
  document.querySelectorAll('.sub-questions').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.q-expand').forEach(el => el.textContent = '▶');
  document.querySelectorAll('.question-item').forEach(el => el.classList.remove('expanded'));
  
  if (!isExpanded) {
    subContainer.classList.remove('hidden');
    expandIcon.textContent = '▼';
    questionDiv.classList.add('expanded');
  }
}

function selectSubQuestion(question, subQuestion, btnElement) {
  // Save current answer
  saveCurrentAnswer();
  
  // Update state
  state.currentQuestion = question;
  state.currentSubQuestion = subQuestion;
  
  // Update UI active states
  document.querySelectorAll('.sub-question-btn').forEach(btn => btn.classList.remove('active'));
  btnElement.classList.add('active');
  
  // Show answer panel
  renderAnswerPanel();
}

function renderExamCode() {
  examCodeEditor.setValue(state.examCode);
  examCodeEditor.refresh();
}

function renderAnswerPanel() {
  const sub = state.currentSubQuestion;
  const q = state.currentQuestion;
  if (!sub || !q) return;
  
  const key = `${q.number}-${sub.letter}`;
  
  // Update title
  document.getElementById('answerTitle').textContent = `Question ${q.number}(${sub.letter})`;
  
  // Show question text
  document.getElementById('questionDisplay').innerHTML = `
    <div class="question-text-display">
      <p>${escapeHtml(sub.text).replace(/\n/g, '<br>')}</p>
    </div>
  `;
  
  // Show answer section
  document.getElementById('answerSection').classList.remove('hidden');
  
  // Toggle between text and code input
  const textWrap = document.getElementById('textAnswerWrap');
  const codeWrap = document.getElementById('codeAnswerWrap');
  
  if (sub.isCoding) {
    textWrap.classList.add('hidden');
    codeWrap.classList.remove('hidden');
    
    const savedAnswer = state.answers[key] ?? sub.starterCode ?? '';
    codeAnswerEditor.setValue(savedAnswer);
    setTimeout(() => codeAnswerEditor.refresh(), 10);
    
    // Listen for changes
    codeAnswerEditor.off('change');
    codeAnswerEditor.on('change', () => {
      state.answers[key] = codeAnswerEditor.getValue();
    });
  } else {
    textWrap.classList.remove('hidden');
    codeWrap.classList.add('hidden');
    
    const textArea = document.getElementById('textAnswer');
    textArea.value = state.answers[key] || '';
    textArea.oninput = () => {
      state.answers[key] = textArea.value;
    };
  }
  
  // Show mark scheme section (hidden by default)
  const msSection = document.getElementById('markSchemeSection');
  msSection.classList.remove('hidden');
  
  // Reset reveal state
  document.getElementById('markSchemeContent').classList.add('hidden');
  document.getElementById('revealMS').innerHTML = '<span class="reveal-icon">▶</span> Click to Reveal Mark Scheme';
  
  // Set mark scheme content
  document.getElementById('marksAvailable').textContent = sub.marks ? `${sub.marks} marks` : '';
  document.getElementById('markSchemeText').innerHTML = formatMarkScheme(sub.markScheme);
  document.getElementById('guidanceText').innerHTML = generateGuidance(sub);
}

function formatMarkScheme(text) {
  return escapeHtml(text)
    .replace(/Award \[(\d+)(?:\s*max)?\]/g, '<span class="award-tag">Award [$1 max]</span>')
    .replace(/\n/g, '<br>');
}

function generateGuidance(sub) {
  const tips = [];
  
  if (sub.isCoding) {
    tips.push('✓ Check your method signature matches the requirements');
    tips.push('✓ Ensure proper use of access modifiers (public/private)');
    tips.push('✓ Remember to use correct Java syntax for loops and conditions');
    tips.push('✓ Consider edge cases like null values or empty arrays');
  } else {
    tips.push('✓ Look for command terms: "outline" = brief description, "describe" = detailed');
    tips.push('✓ "State" questions need concise, factual answers');
    tips.push('✓ "Explain" requires reasons or justifications');
    tips.push('✓ Use technical terminology from the IB CS syllabus');
  }
  
  // Add specific guidance based on content
  if (sub.text.toLowerCase().includes('inherit')) {
    tips.push('💡 Inheritance: remember "extends" keyword and parent-child relationship');
  }
  if (sub.text.toLowerCase().includes('encapsul')) {
    tips.push('💡 Encapsulation: private attributes + public getters/setters');
  }
  if (sub.text.toLowerCase().includes('polymorphism')) {
    tips.push('💡 Polymorphism: same method name, different implementations');
  }
  if (sub.text.toLowerCase().includes('constructor')) {
    tips.push('💡 Constructor: same name as class, no return type');
  }
  
  return tips.map(t => `<div class="tip">${t}</div>`).join('');
}

function clearAnswerPanel() {
  document.getElementById('answerTitle').textContent = 'Select a question';
  document.getElementById('questionDisplay').innerHTML = `
    <p class="placeholder-text">Click on a sub-question (a), (b), (c)... from the left panel to begin.</p>
  `;
  document.getElementById('answerSection').classList.add('hidden');
  document.getElementById('markSchemeSection').classList.add('hidden');
}

function saveCurrentAnswer() {
  if (!state.currentSubQuestion || !state.currentQuestion) return;
  
  const key = `${state.currentQuestion.number}-${state.currentSubQuestion.letter}`;
  
  if (state.currentSubQuestion.isCoding) {
    state.answers[key] = codeAnswerEditor.getValue();
  } else {
    state.answers[key] = document.getElementById('textAnswer').value;
  }
}

// ============== UTILITIES ==============
function truncate(text, len) {
  const clean = text.replace(/\s+/g, ' ').trim();
  const firstLine = clean.split('\n')[0];
  return firstLine.length > len ? firstLine.slice(0, len) + '…' : firstLine;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function copyToClipboard(text) {
  navigator.clipboard?.writeText(text).catch(err => console.error('Copy failed:', err));
}
