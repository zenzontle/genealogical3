import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const textFilePattern = /\.(?:css|html|js|jsx|md|mjs|ts|tsx|txt|json|yml|yaml)$/i;
const curlyQuotePattern = /[\u2018\u2019\u201C\u201D]/;
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter((file) => file && textFilePattern.test(file));
const violations = [];

for (const file of files) {
  const contents = readFileSync(file, 'utf8');
  const lines = contents.split(/\r?\n/);

  lines.forEach((line, index) => {
    if (curlyQuotePattern.test(line)) {
      violations.push(`${file}:${index + 1}: replace curly quotation marks with straight quotes`);
    }
  });
}

if (violations.length > 0) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log('No curly quotation marks found in tracked text files.');
}
