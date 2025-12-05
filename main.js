// State management
const state = {
  exams: [],
  questions: [],
  currentQuestion: null,
  currentSubQuestion: null,
  answers: {},
  examCode: '',
  currentLevel: 'SL', // SL or HL
};

let codeAnswerEditor = null;
let examCodeEditor = null;

document.addEventListener('DOMContentLoaded', () => {
  initEditors();
  wireEvents();
  loadManifest();
});

// ============== EDITORS ==============
function initEditors() {
  // Exam code editor (read-only)
  examCodeEditor = CodeMirror.fromTextArea(document.getElementById('examCode'), {
    mode: 'text/x-java',
    theme: 'default',
    lineNumbers: true,
    readOnly: true,
    tabSize: 4,
    indentUnit: 4,
    lineWrapping: false,
  });
  
  // Answer code editor
  codeAnswerEditor = CodeMirror.fromTextArea(document.getElementById('codeAnswer'), {
    mode: 'text/x-java',
    theme: 'default',
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
  document.getElementById('copyCode').addEventListener('click', () => {
    copyToClipboard(examCodeEditor.getValue());
  });
  
  document.getElementById('clearAnswer').addEventListener('click', clearCurrentAnswer);
  
  document.getElementById('revealMS').addEventListener('click', toggleMarkScheme);
  
  // Hide theme toggle since we're using clean white
  const themeBtn = document.getElementById('themeToggle');
  if (themeBtn) themeBtn.style.display = 'none';
  
  // Level toggle (SL/HL)
  document.getElementById('slBtn').addEventListener('click', () => setLevel('SL'));
  document.getElementById('hlBtn').addEventListener('click', () => setLevel('HL'));
}

function setLevel(level) {
  state.currentLevel = level;
  
  // Update button states
  document.getElementById('slBtn').classList.toggle('active', level === 'SL');
  document.getElementById('hlBtn').classList.toggle('active', level === 'HL');
  
  // Repopulate exam select with filtered exams
  populateExamSelect(state.exams);
  
  // Load first exam of this level
  const filteredExams = state.exams.filter(e => e.level === level);
  if (filteredExams.length) {
    document.getElementById('examSelect').value = filteredExams[filteredExams.length - 1].id;
    loadExam(filteredExams[filteredExams.length - 1].id);
  }
}

function clearCurrentAnswer() {
  if (!state.currentSubQuestion) return;
  
  const key = `${state.currentQuestion.number}-${state.currentSubQuestion.letter}`;
  
  if (state.currentSubQuestion.isCoding) {
    codeAnswerEditor.setValue(state.currentSubQuestion.starterCode || '// Write your code here\n\n');
    state.answers[key] = state.currentSubQuestion.starterCode || '';
  } else {
    document.getElementById('textAnswer').value = '';
    state.answers[key] = '';
  }
}

function toggleMarkScheme() {
  const content = document.getElementById('markSchemeContent');
  const btn = document.getElementById('revealMS');
  
  if (content.classList.contains('hidden')) {
    content.classList.remove('hidden');
    btn.innerHTML = '<span class="reveal-icon">▼</span> Hide Mark Scheme';
  } else {
    content.classList.add('hidden');
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
    
    // Load the most recent exam of the current level
    const filteredExams = exams.filter(e => e.level === state.currentLevel);
    if (filteredExams.length) {
      document.getElementById('examSelect').value = filteredExams[filteredExams.length - 1].id;
      await loadExam(filteredExams[filteredExams.length - 1].id);
    }
  } catch (err) {
    console.error('Failed to load manifest:', err);
  }
}

function populateExamSelect(exams) {
  const select = document.getElementById('examSelect');
  const currentValue = select.value;
  select.innerHTML = '';
  
  // Filter by current level
  const filteredExams = exams.filter(e => e.level === state.currentLevel);
  
  filteredExams.forEach(exam => {
    const opt = document.createElement('option');
    opt.value = exam.id;
    opt.textContent = exam.label;
    select.appendChild(opt);
  });
  
  // Only add event listener once
  if (!select.dataset.listenerAdded) {
    select.addEventListener('change', e => loadExam(e.target.value));
    select.dataset.listenerAdded = 'true';
  }
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
  
  // Extract scenario/context information
  const scenarioContext = extractScenarioContext(optionDText);
  
  // Extract all Java code from the exam - improved extraction
  const javaCode = extractAllJavaCode(optionDText);
  
  // Combine scenario context with Java code
  state.examCode = scenarioContext + javaCode;
  
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
    .filter(q => parseInt(q.number, 10) >= 10)
    .map(q => {
      const subQuestions = parseSubQuestions(q.text, false).map(sub => {
        const msKey = `${q.number}-${sub.letter}`;
        const ms = msMap.get(msKey);
        return {
          ...sub,
          markScheme: ms?.text || 'Mark scheme not available.',
          marks: ms?.marks || sub.marks,
          isCoding: detectCodingQuestion(sub.text),
          starterCode: extractStarterCode(sub.text, state.examCode),
        };
      });
      
      return {
        number: q.number,
        text: q.text,
        subQuestions,
      };
    });
}

function extractScenarioContext(text) {
  // Extract the scenario/context that appears before the first sub-question
  // This contains important background information for students
  
  const lines = text.split(/\r?\n/);
  const contextLines = [];
  let inContext = false;
  let foundFirstQuestion = false;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip header lines
    if (/Option D/i.test(trimmed) || /^–?\s*\d+\s*–?$/.test(trimmed) || 
        /^\d{4}\s*–\s*\d{4}$/.test(trimmed) || /M\d{2}\/\d\//.test(trimmed)) {
      continue;
    }
    
    // Start collecting after we see a main question number
    if (/^1[0-9]\.$/.test(trimmed) || /^[0-9]\.$/.test(trimmed)) {
      inContext = true;
      continue;
    }
    
    // Stop at first sub-question
    if (/^\([a-z]\)/i.test(trimmed)) {
      foundFirstQuestion = true;
      break;
    }
    
    // Collect context lines (but not UML attributes or code)
    if (inContext && trimmed && !foundFirstQuestion) {
      // Skip UML notation lines and page references
      if (!/^[-+]\s*\w+\s*:/.test(trimmed) && 
          !/Option D continues/i.test(trimmed) &&
          !/^Turn over$/i.test(trimmed) &&
          !/^\[.*\]$/.test(trimmed) &&
          !/^public\s+(class|interface)/.test(trimmed) &&
          !/^private\s+/.test(trimmed)) {
        contextLines.push(trimmed);
      }
    }
  }
  
  if (contextLines.length < 3) return '';
  
  // Format the context as a comment block
  const context = contextLines.slice(0, 15).join('\n');
  
  return `/*
 * ==========================================
 * EXAM SCENARIO / CONTEXT
 * ==========================================
 * ${context.split('\n').join('\n * ')}
 * ==========================================
 */

`;
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
  let braceDepth = 0;
  let inClass = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Detect start of a Java class or significant code block
    if (/^public\s+class\s+\w+/.test(trimmed) || 
        /^class\s+\w+/.test(trimmed) ||
        /^public\s+interface\s+\w+/.test(trimmed)) {
      if (currentBlock.length > 0 && braceDepth === 0) {
        codeBlocks.push(currentBlock.join('\n'));
        currentBlock = [];
      }
      inClass = true;
    }
    
    // Count braces to track block depth
    const openBraces = (line.match(/{/g) || []).length;
    const closeBraces = (line.match(/}/g) || []).length;
    
    // Determine if this looks like code
    const isCodeLine = 
      /^\s*(public|private|protected|class|interface|static|void|int|double|boolean|String|char|float|long|new|return|if|else|for|while|try|catch|throw|import|package)\b/.test(line) ||
      /^\s*\/\//.test(line) ||  // Comment
      /^\s*\/\*/.test(line) ||  // Block comment start
      /^\s*\*/.test(line) ||    // Block comment middle
      /^\s*{/.test(trimmed) ||
      /^\s*}/.test(trimmed) ||
      /;\s*$/.test(trimmed) ||
      (inClass && braceDepth > 0) ||
      /^\s*\w+\s*\(.*\)/.test(line) || // Method calls
      /^\s*\w+\[\]/.test(line); // Arrays
    
    if (isCodeLine || (inClass && braceDepth > 0)) {
      currentBlock.push(line);
      braceDepth += openBraces - closeBraces;
      
      if (braceDepth <= 0 && inClass && currentBlock.length > 0) {
        codeBlocks.push(currentBlock.join('\n'));
        currentBlock = [];
        inClass = false;
        braceDepth = 0;
      }
    } else if (currentBlock.length > 0 && trimmed === '') {
      // Allow empty lines within code blocks
      if (braceDepth > 0) {
        currentBlock.push(line);
      }
    } else if (currentBlock.length > 5 && braceDepth === 0) {
      // Save block if substantial
      codeBlocks.push(currentBlock.join('\n'));
      currentBlock = [];
      inClass = false;
    }
  }
  
  if (currentBlock.length > 3) {
    codeBlocks.push(currentBlock.join('\n'));
  }
  
  // Extract UML diagrams and tables
  const diagrams = extractDiagrams(text);
  
  // If we found actual Java classes, combine with diagrams
  const javaClasses = codeBlocks.filter(block => 
    /class\s+\w+/.test(block) && block.includes('{')
  );
  
  let result = '';
  
  // Add UML diagrams first as comments
  if (diagrams.length > 0) {
    result += diagrams.join('\n\n') + '\n\n';
  }
  
  if (javaClasses.length > 0) {
    result += javaClasses.join('\n\n');
    return result;
  }
  
  // Fall back to UML-style if no Java classes found
  const umlBlock = extractUMLAsJava(text);
  if (umlBlock) {
    return result + umlBlock;
  }
  
  // Last resort - return any code we found
  if (codeBlocks.length > 0) {
    return result + codeBlocks.join('\n\n');
  }
  
  return result || '// No Java code provided in this exam.\n// Refer to the question text for class specifications.';
}

// ============== DIAGRAM EXTRACTION ==============
function extractDiagrams(text) {
  const diagrams = [];
  
  // Extract UML class diagrams
  const umlDiagrams = extractUMLDiagrams(text);
  diagrams.push(...umlDiagrams);
  
  // Extract tables (loyalty levels, database tables, etc.)
  const tables = extractTables(text);
  diagrams.push(...tables);
  
  // Extract binary tree diagrams
  const trees = extractBinaryTrees(text);
  diagrams.push(...trees);
  
  return diagrams;
}

function extractUMLDiagrams(text) {
  const diagrams = [];
  const lines = text.split(/\r?\n/);
  
  // Pattern to detect UML class diagram blocks
  // Looking for patterns like:
  // ClassName
  // - attribute: Type
  // + method()
  
  let currentClass = null;
  let exampleData = [];
  const classes = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Detect class name (PascalCase word alone on a line, not part of a sentence)
    if (/^[A-Z][a-zA-Z]+$/.test(line) && !line.includes(' ') && line.length > 2) {
      // Check if next lines have UML attributes
      const nextLines = lines.slice(i + 1, i + 10).map(l => l.trim());
      const hasUMLAttributes = nextLines.some(l => /^[-+]\s*\w+\s*:/.test(l));
      
      if (hasUMLAttributes) {
        if (currentClass && currentClass.attributes.length > 0) {
          classes.push({ ...currentClass, exampleData: [...exampleData] });
        }
        currentClass = { name: line, attributes: [], methods: [] };
        exampleData = [];
        continue;
      }
    }
    
    // Detect "example X object" pattern
    if (/example\s+\w+\s+object/i.test(line) && currentClass) {
      // Next few lines might be example data
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        const dataLine = lines[j].trim();
        if (dataLine && !dataLine.startsWith('-') && !dataLine.startsWith('+') && 
            !dataLine.startsWith('(') && !/^[A-Z][a-z]/.test(dataLine)) {
          exampleData.push(dataLine);
        } else if (/^[-+]/.test(dataLine) || /^\(/.test(dataLine)) {
          break;
        }
      }
    }
    
    // Detect UML attribute: - attributeName: Type
    if (currentClass && /^[-+]\s*\w+\s*:\s*\w+/.test(line)) {
      const match = line.match(/^([-+])\s*(\w+)\s*:\s*(\w+)/);
      if (match) {
        currentClass.attributes.push({
          visibility: match[1] === '-' ? 'private' : 'public',
          name: match[2],
          type: match[3]
        });
      }
    }
    
    // Detect UML method: + methodName() or + constructor
    if (currentClass && /^[-+]\s*(\w+\s*\(|constructor|accessor|mutator)/i.test(line)) {
      currentClass.methods.push(line.replace(/^[-+]\s*/, ''));
    }
  }
  
  if (currentClass && currentClass.attributes.length > 0) {
    classes.push({ ...currentClass, exampleData });
  }
  
  // Convert to ASCII art
  for (const cls of classes) {
    diagrams.push(createUMLAsciiArt(cls));
  }
  
  return diagrams;
}

function createUMLAsciiArt(cls) {
  const lines = [];
  const width = Math.max(
    cls.name.length + 4,
    ...cls.attributes.map(a => `${a.visibility === 'private' ? '-' : '+'} ${a.name}: ${a.type}`.length + 2),
    ...cls.methods.map(m => `+ ${m}`.length + 2),
    30
  );
  
  const border = '+' + '-'.repeat(width) + '+';
  const empty = '|' + ' '.repeat(width) + '|';
  
  lines.push('/*');
  lines.push(' * UML Class Diagram:');
  lines.push(' * ' + border);
  lines.push(' * |' + cls.name.padStart((width + cls.name.length) / 2).padEnd(width) + '|');
  lines.push(' * ' + border);
  
  // Attributes
  for (const attr of cls.attributes) {
    const symbol = attr.visibility === 'private' ? '-' : '+';
    const attrStr = `${symbol} ${attr.name}: ${attr.type}`;
    lines.push(' * |' + attrStr.padEnd(width) + '|');
  }
  
  lines.push(' * ' + border);
  
  // Methods
  for (const method of cls.methods) {
    const methodStr = `+ ${method}`;
    lines.push(' * |' + methodStr.padEnd(width) + '|');
  }
  
  lines.push(' * ' + border);
  
  // Example data if available
  if (cls.exampleData && cls.exampleData.length > 0) {
    lines.push(' *');
    lines.push(' * Example ' + cls.name + ' object:');
    cls.exampleData.forEach(d => {
      lines.push(' *   ' + d);
    });
  }
  
  lines.push(' */');
  
  return lines.join('\n');
}

function extractTables(text) {
  const tables = [];
  const lines = text.split(/\r?\n/);
  
  // Look for patterns indicating tables
  // - Loyalty level tables (Bronze/Silver/Gold/Diamond)
  // - Status threshold tables
  
  // Detect loyalty/status tables
  const loyaltyMatch = text.match(/Bronze\s*[=<>]\s*(?:less than\s*)?\d[\d\s,]*(?:points)?/i);
  const silverMatch = text.match(/Silver\s*[=<>]\s*\d[\d\s,]*(?:points)?/i);
  const goldMatch = text.match(/Gold\s*[=<>]\s*\d[\d\s,]*(?:points)?/i);
  
  if (loyaltyMatch || silverMatch || goldMatch) {
    const statusTable = extractStatusTable(text);
    if (statusTable) {
      tables.push(statusTable);
    }
  }
  
  // Detect Number of rentals -> Level table pattern
  if (/Number of rentals.*Level/i.test(text) || /rentals.*level/i.test(text)) {
    const rentalTable = extractRentalLevelTable(text);
    if (rentalTable) {
      tables.push(rentalTable);
    }
  }
  
  return tables;
}

function extractStatusTable(text) {
  // Extract Bronze/Silver/Gold point thresholds
  const rules = [];
  
  const bronzeMatch = text.match(/Bronze\s*[=:]\s*(?:less than\s*)?(\d[\d\s,]*)/i);
  const silverMatch = text.match(/Silver\s*[=:]\s*(\d[\d\s,]*)\s*(?:or more)?(?:\s*but\s*less than\s*(\d[\d\s,]*))?/i);
  const goldMatch = text.match(/Gold\s*[=:]\s*(\d[\d\s,]*)\s*(?:or more)?/i);
  
  if (bronzeMatch) rules.push({ level: 'Bronze', threshold: bronzeMatch[1].trim() });
  if (silverMatch) rules.push({ level: 'Silver', threshold: silverMatch[1].trim() + (silverMatch[2] ? ' - ' + silverMatch[2].trim() : '+') });
  if (goldMatch) rules.push({ level: 'Gold', threshold: goldMatch[1].trim() + '+' });
  
  if (rules.length === 0) return null;
  
  const lines = [];
  lines.push('/*');
  lines.push(' * Status Level Thresholds:');
  lines.push(' * +----------------+----------------------+');
  lines.push(' * | Level          | Points Required      |');
  lines.push(' * +----------------+----------------------+');
  for (const rule of rules) {
    lines.push(' * | ' + rule.level.padEnd(14) + ' | ' + rule.threshold.padEnd(20) + ' |');
  }
  lines.push(' * +----------------+----------------------+');
  lines.push(' */');
  
  return lines.join('\n');
}

function extractRentalLevelTable(text) {
  // Extract loyalty program level thresholds for rental company
  const lines = [];
  
  // Look for patterns like "Greater than 19 -> Diamond"
  const diamondMatch = text.match(/(?:Greater than|>)\s*(\d+)\s*(?:[\r\n]+\s*)?Diamond/i);
  const goldMatch = text.match(/(?:Greater than|>)\s*(\d+)\s*(?:[\r\n]+\s*)?Gold/i);
  const silverMatch = text.match(/(?:Greater than|>)\s*(\d+)\s*(?:[\r\n]+\s*)?Silver/i);
  const basicMatch = text.match(/(?:Up to|<=?)\s*(\d+)\s*(?:[\r\n]+\s*)?Basic/i);
  
  const rules = [];
  if (diamondMatch) rules.push({ level: 'Diamond', threshold: '> ' + diamondMatch[1] });
  if (goldMatch) rules.push({ level: 'Gold', threshold: '> ' + goldMatch[1] });
  if (silverMatch) rules.push({ level: 'Silver', threshold: '> ' + silverMatch[1] });
  if (basicMatch) rules.push({ level: 'Basic', threshold: '≤ ' + basicMatch[1] });
  
  if (rules.length === 0) return null;
  
  lines.push('/*');
  lines.push(' * Loyalty Program Levels:');
  lines.push(' * +----------------+----------------------+');
  lines.push(' * | Level          | Rentals Required     |');
  lines.push(' * +----------------+----------------------+');
  for (const rule of rules) {
    lines.push(' * | ' + rule.level.padEnd(14) + ' | ' + rule.threshold.padEnd(20) + ' |');
  }
  lines.push(' * +----------------+----------------------+');
  lines.push(' */');
  
  return lines.join('\n');
}

function extractBinaryTrees(text) {
  const trees = [];
  
  // Look for Figure references with binary tree data
  const figureMatch = text.match(/Figure\s+\d+[:\s]*.*binary\s+(?:search\s+)?tree/i);
  
  if (figureMatch) {
    // Try to extract the tree node values
    // Look for patterns like a tree structure in the text
    const treeData = extractTreeNodeValues(text);
    if (treeData) {
      trees.push(createBinaryTreeAscii(treeData));
    }
  }
  
  // Also check for date-based tree examples
  if (/binary\s+tree.*dateOut/i.test(text) || /dateOut.*binary\s+tree/i.test(text)) {
    const dateTree = extractDateTreeData(text);
    if (dateTree) {
      trees.push(dateTree);
    }
  }
  
  return trees;
}

function extractTreeNodeValues(text) {
  // Look for a sequence of numbers that might represent tree nodes
  // Pattern: root -> children arrangement
  
  // Try to find customerID sequences or numeric sequences
  const numberMatches = text.match(/root[\s\S]*?(\d{3}[\s\S]*?\d{3})/);
  if (numberMatches) {
    const numbers = numberMatches[1].match(/\d{3}/g);
    if (numbers && numbers.length >= 3) {
      return numbers;
    }
  }
  
  return null;
}

function createBinaryTreeAscii(nodes) {
  if (!nodes || nodes.length === 0) return null;
  
  const lines = [];
  lines.push('/*');
  lines.push(' * Binary Search Tree (from exam figure):');
  lines.push(' *');
  
  // Simple tree representation for 7 nodes
  if (nodes.length >= 7) {
    lines.push(' *              [' + nodes[0] + ']');
    lines.push(' *              /     \\');
    lines.push(' *          [' + nodes[1] + ']     [' + nodes[2] + ']');
    lines.push(' *          /   \\       /   \\');
    lines.push(' *       [' + nodes[3] + '] [' + nodes[4] + '] [' + nodes[5] + '] [' + nodes[6] + ']');
  } else if (nodes.length >= 3) {
    lines.push(' *         [' + nodes[0] + ']');
    lines.push(' *         /     \\');
    lines.push(' *     [' + nodes[1] + ']   [' + nodes[2] + ']');
  }
  
  lines.push(' *');
  lines.push(' * Note: This is a visual representation from the exam.');
  lines.push(' * Refer to the question for exact node arrangement.');
  lines.push(' */');
  
  return lines.join('\n');
}

function extractDateTreeData(text) {
  // Look for customerID/dateOut table data
  const lines = [];
  const tableData = [];
  
  const datePattern = /(\d+)\s+(\d{2}\/\d{2}\/\d{4})/g;
  let match;
  while ((match = datePattern.exec(text)) !== null) {
    tableData.push({ id: match[1], date: match[2] });
  }
  
  if (tableData.length === 0) return null;
  
  lines.push('/*');
  lines.push(' * Data for Binary Tree Construction:');
  lines.push(' * +-------------+-------------+');
  lines.push(' * | customerID  | dateOut     |');
  lines.push(' * +-------------+-------------+');
  for (const row of tableData) {
    lines.push(' * | ' + row.id.padEnd(11) + ' | ' + row.date.padEnd(11) + ' |');
  }
  lines.push(' * +-------------+-------------+');
  lines.push(' * ');
  lines.push(' * Build the BST by inserting nodes in order of dateOut.');
  lines.push(' */');
  
  return lines.join('\n');
}

function extractUMLAsJava(text) {
  const lines = text.split(/\r?\n/);
  let className = '';
  const attributes = [];
  
  for (const line of lines) {
    // Look for class name (usually appears before attributes)
    if (/^[A-Z][a-zA-Z]*$/.test(line.trim()) && !className) {
      className = line.trim();
      continue;
    }
    
    // UML attribute: - attributeName: Type
    const attrMatch = line.match(/^[-+]\s*(\w+)\s*:\s*(\w+)/);
    if (attrMatch) {
      const [, name, type] = attrMatch;
      const javaType = convertUMLType(type);
      attributes.push({ name, type: javaType, visibility: line.trim().startsWith('-') ? 'private' : 'public' });
      continue;
    }
  }
  
  if (!className || attributes.length === 0) {
    return null;
  }
  
  // Build Java class - ONLY show structure, NOT the methods students need to write
  let java = `public class ${className} {\n\n`;
  java += `    // Instance variables (from UML diagram)\n`;
  
  for (const attr of attributes) {
    java += `    ${attr.visibility} ${attr.type} ${attr.name};\n`;
  }
  
  java += `\n    // Default constructor\n`;
  java += `    public ${className}() {\n`;
  java += `        // Initializes instance variables to default values\n`;
  java += `    }\n`;
  
  java += `\n    // Accessor and mutator methods are listed in the UML\n`;
  java += `    // but YOU need to write them as part of the questions!\n`;
  
  java += `\n}\n`;
  
  return java;
}

function convertUMLType(umlType) {
  const typeMap = {
    'integer': 'int',
    'real': 'double',
    'boolean': 'boolean',
    'String': 'String',
    'char': 'char',
  };
  return typeMap[umlType.toLowerCase()] || umlType;
}

function splitMainQuestions(text) {
  const lines = text.split(/\r?\n/);
  const questions = [];
  let current = null;
  
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
  
  const subPattern = /^\(([a-z])\)\s*/i;
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
    /\bconstruct\b.*\b(code|method|class)\b/i,
    /\bwrite\b.*\b(code|method)\b/i,
    /\bcreate\b.*\bmethod\b/i,
    /\bimplement\b/i,
  ];
  return codingKeywords.some(re => re.test(text));
}

function extractStarterCode(questionText, examCode) {
  // For accessor methods like getBrandModel()
  const accessorMatch = questionText.match(/accessor\s+method\s+(\w+)\s*\(\)/i) ||
                        questionText.match(/method\s+(get\w+)\s*\(\)/i);
  if (accessorMatch) {
    const methodName = accessorMatch[1];
    // Don't provide return type - student should figure it out
    return `// Write your ${methodName}() method below\n\n`;
  }
  
  // For mutator methods like setX()
  const mutatorMatch = questionText.match(/mutator\s+method\s+(\w+)\s*\(/i) ||
                       questionText.match(/method\s+(set\w+)\s*\(/i);
  if (mutatorMatch) {
    const methodName = mutatorMatch[1];
    return `// Write your ${methodName}() method below\n\n`;
  }
  
  // For general methods like findBrandModels()
  const methodMatch = questionText.match(/method\s+(\w+)\s*\(\)/i);
  if (methodMatch) {
    const methodName = methodMatch[1];
    return `// Write your ${methodName}() method below\n\n`;
  }
  
  // Check if it's asking for a class with extends
  const extendsMatch = questionText.match(/class\s+(\w+).*extends/i);
  if (extendsMatch) {
    const className = extendsMatch[1];
    return `// Write the ${className} class below\n\n`;
  }
  
  // Check if it's asking for a class
  const classMatch = questionText.match(/class\s+(\w+)/i);
  if (classMatch) {
    const className = classMatch[1];
    return `// Write the ${className} class below\n\n`;
  }
  
  // Generic coding question
  return '// Write your code below\n\n';
}

// ============== RENDERING ==============
function renderQuestionList() {
  const container = document.getElementById('questionList');
  container.innerHTML = '';
  
  state.questions.forEach(q => {
    const questionDiv = document.createElement('div');
    questionDiv.className = 'question-item';
    
    const header = document.createElement('button');
    header.className = 'question-header';
    header.innerHTML = `
      <span class="q-number">Q${q.number}</span>
      <span class="q-expand">▶</span>
    `;
    header.addEventListener('click', () => toggleQuestionExpand(questionDiv, q));
    
    const subContainer = document.createElement('div');
    subContainer.className = 'sub-questions hidden';
    
    q.subQuestions.forEach(sub => {
      const subBtn = document.createElement('button');
      subBtn.className = 'sub-question-btn';
      subBtn.innerHTML = `
        <span class="sub-letter">(${sub.letter})</span>
        <span class="sub-preview">${truncate(sub.text, 50)}</span>
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
  saveCurrentAnswer();
  
  state.currentQuestion = question;
  state.currentSubQuestion = subQuestion;
  
  document.querySelectorAll('.sub-question-btn').forEach(btn => btn.classList.remove('active'));
  btnElement.classList.add('active');
  
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
  
  document.getElementById('answerTitle').textContent = `Question ${q.number}(${sub.letter})`;
  
  document.getElementById('questionDisplay').innerHTML = `
    <div class="question-text-display">
      <p>${escapeHtml(sub.text).replace(/\n/g, '<br>')}</p>
    </div>
  `;
  
  document.getElementById('answerSection').classList.remove('hidden');
  
  const textWrap = document.getElementById('textAnswerWrap');
  const codeWrap = document.getElementById('codeAnswerWrap');
  
  if (sub.isCoding) {
    textWrap.classList.add('hidden');
    codeWrap.classList.remove('hidden');
    
    const savedAnswer = state.answers[key] ?? sub.starterCode ?? '// Write your code here\n\n';
    codeAnswerEditor.setValue(savedAnswer);
    setTimeout(() => codeAnswerEditor.refresh(), 10);
    
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
  
  // Show mark scheme section but keep it hidden by default
  const msSection = document.getElementById('markSchemeSection');
  msSection.classList.remove('hidden');
  
  // ALWAYS hide mark scheme content by default
  document.getElementById('markSchemeContent').classList.add('hidden');
  document.getElementById('revealMS').innerHTML = '<span class="reveal-icon">▶</span> Click to Reveal Mark Scheme';
  
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
    tips.push('✓ Check method signature matches requirements');
    tips.push('✓ Use correct access modifiers (public/private)');
    tips.push('✓ Remember proper Java syntax');
    tips.push('✓ Consider edge cases');
  } else {
    tips.push('✓ "Outline" = brief description');
    tips.push('✓ "Describe" = detailed explanation');
    tips.push('✓ "State" = concise, factual answer');
    tips.push('✓ "Explain" = give reasons');
  }
  
  if (sub.text.toLowerCase().includes('inherit')) {
    tips.push('💡 Inheritance: use "extends" keyword');
  }
  if (sub.text.toLowerCase().includes('encapsul')) {
    tips.push('💡 Encapsulation: private fields + public getters/setters');
  }
  if (sub.text.toLowerCase().includes('constructor')) {
    tips.push('💡 Constructor: same name as class, no return type');
  }
  
  return tips.map(t => `<div class="tip">${t}</div>`).join('');
}

function clearAnswerPanel() {
  document.getElementById('answerTitle').textContent = 'Select a question';
  document.getElementById('questionDisplay').innerHTML = `
    <p class="placeholder-text">Click a sub-question (a), (b), (c)... from the left panel to begin.</p>
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
  return clean.length > len ? clean.slice(0, len) + '…' : clean;
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
