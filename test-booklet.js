function getBookletPages(totalPages) {
    let finalPages = [];
    for (let i = 1; i <= totalPages; i++) finalPages.push(i);
    while (finalPages.length % 4 !== 0) finalPages.push(null);

    let outputs = [];
    let outputPageCount = finalPages.length / 2;
    for (let i = 0; i < outputPageCount; i++) {
        let leftPage, rightPage;
        const isFront = (i % 2 === 0);
        if (isFront) {
            leftPage = finalPages[finalPages.length - 1 - i];
            rightPage = finalPages[i];
        } else {
            leftPage = finalPages[i];
            rightPage = finalPages[finalPages.length - 1 - i];
        }
        outputs.push({left: leftPage, right: rightPage, isFront});
    }
    return outputs;
}

console.log("4 Pages:", getBookletPages(4));
console.log("8 Pages:", getBookletPages(8));
console.log("3 Pages:", getBookletPages(3));
