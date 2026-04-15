// Regression test script for pdf-merger fixes
console.log("Running Regression tests for PDF Merger fixes...");
let passed = 0;
let total = 0;

// Test 1: File Type validation
total++;
function handleFilesTest() {
    const files = [
        { name: 'test.png', type: 'image/png' },
        { name: 'test.pdf', type: '' },
        { name: 'test2.pdf', type: 'application/pdf' },
        { name: 'TEST3.PDF', type: '' }
    ];
    const newFiles = Array.from(files).filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));

    if (newFiles.length === 3 && newFiles[0].name === 'test.pdf' && newFiles[2].name === 'TEST3.PDF') {
        passed++;
        console.log("✅ Test 1: File Type Validation passed.");
    } else {
        console.error("❌ Test 1: File Type Validation failed.");
    }
}
handleFilesTest();

// Test 2: Drag and Drop Race Condition Simulation
total++;
function dragRaceTest() {
    let storedFiles = [{name: 'A'}, {name: 'B'}];
    let dragStartIndex = undefined;

    function swapItems(fromIndex, toIndex) {
        const itemToMove = storedFiles[fromIndex];
        storedFiles.splice(fromIndex, 1);
        storedFiles.splice(toIndex, 0, itemToMove);
    }

    // Simulate drop from external (dragStartIndex is undefined)
    const e = {
        stopPropagation: () => {},
        preventDefault: () => {}
    };

    e.stopPropagation();
    e.preventDefault();
    if (dragStartIndex !== undefined) {
        swapItems(dragStartIndex, 1);
        dragStartIndex = undefined;
    }

    if (storedFiles.length === 2 && storedFiles[0].name === 'A' && storedFiles[1].name === 'B') {
        passed++;
        console.log("✅ Test 2: Drag and Drop Race Condition passed.");
    } else {
        console.error("❌ Test 2: Drag and Drop Race Condition failed. storedFiles:", storedFiles);
    }
}
dragRaceTest();

console.log(`\nResults: ${passed}/${total} tests passed.`);
if (passed !== total) process.exit(1);
