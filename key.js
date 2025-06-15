const fs = require('fs');
const keyGen = async () => {
    const timestamp = Date.now();
    const playerScriptUrl = `https://megacloud.blog/js/player/a/v2/pro/embed-1.min.js?v=${timestamp}`;
    console.log(`🔗 Player script URL: ${playerScriptUrl}`);
    try {
        console.log("📥 Fetching obfuscated player script...");
        // Fetch the player script content from the URL
        const scriptContent = await fetch(playerScriptUrl).then(response => {
            if (!response.ok) {
                throw new Error(`HTTP Error: ${response.status}`);
            }
            return response.text();
        });

        // Keep this for debugging if needed
        // console.log("✅ Script fetched.", scriptContent.slice(0, 10) + "...");
        // writeFileSync(__dirname + "/" + "megacloud-player.js", scriptContent);

        // Get the first character of the script, which is the main function name
        const mainFunctionName = scriptContent[0];

        // Extract the main function declaration (e.g., "function a() { }")
        const mainFunctionRegex = new RegExp(`function\\s+${mainFunctionName}\\s*\\(\\)\\s*\\{[^}]*\\}`);
        const mainFunctionMatch = scriptContent.match(mainFunctionRegex);

        if (!mainFunctionMatch) {
            console.error(`❌ Could not extract function ${mainFunctionName}()`);
            return;
        }


        // Extract assignments to the main function (e.g., a.x = ..., a["x"] = ..., a[123] = ...)
        const assignmentRegex = new RegExp(`${mainFunctionName}(?:\\.[\\w$]+|\\[.*?\\])\\s*=\\s*[^;]+;`, 'g');
        const functionAssignments = [...scriptContent.matchAll(assignmentRegex)].map(match => match[0]);

        console.log(`🧩 Found ${functionAssignments.length} assignments to '${mainFunctionName}'.`);

        // Regular expression to split the script into two parts based on a common pattern
        const scriptPattern = /([\s\S]*?function\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*\(\)\s*\{\s*return[\s\S]*?\})\s*([\s\S]*)/;
        const patternMatch = scriptPattern.exec(scriptContent);

        const firstCodePart = patternMatch[1];
        const secondCodePart = patternMatch[2]; // Keep this for later if needed

        // Regex to find the initializer line (e.g., "var varName = mainFunctionName;")
        const initializerRegex = new RegExp(`var\\s+\\w+\\s*=\\s*${mainFunctionName}\\s*;`);

        // Regex to find function calls after initializerRegex (e.g., c = () => {;)

        const arrowFunctionAssignmentRegex = /(\w+)\s*=\s*\(\s*\)\s*=>\s*{/g;

        const functionCallNames = [];
        let match;
        while ((match = arrowFunctionAssignmentRegex.exec(scriptContent)) !== null) {
            functionCallNames.push(match[1]);
        }

        console.log(`🔍 Found ${functionCallNames.length} function calls:`, functionCallNames);

        // Helper function to extract an arrow function based on its name
        const getArrowFunctionBody = (codeString, funcName) => {
            const escapeRegExp = str => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // Pattern to specifically look for "name = () => {"
            const arrowFunctionPattern = new RegExp(`${escapeRegExp(funcName)}\\s*=\\s*\\(\\s*\\)\\s*=>\\s*{`);
            console.log("Pattern used:", arrowFunctionPattern); // For debugging

            const match = arrowFunctionPattern.exec(codeString);
            if (!match) return null;

            let startIndex = match.index;
            let currentIdx = match.index;
            let braceBalance = 0;
            let inString = false;
            let stringDelimiter = null;

            // Find the opening brace of the function body
            while (currentIdx < codeString.length) {
                if (codeString[currentIdx] === '{') {
                    braceBalance++;
                    break;
                }
                currentIdx++;
            }

            if (braceBalance === 0) return null; // No opening brace found after the arrow

            // Now, continue to find the corresponding closing brace
            while (currentIdx < codeString.length) {
                const char = codeString[currentIdx];

                if (!inString && (char === '"' || char === "'" || char === '`')) {
                    inString = true;
                    stringDelimiter = char;
                } else if (inString && char === stringDelimiter && codeString[currentIdx - 1] !== '\\') {
                    inString = false;
                } else if (!inString) {
                    if (char === '{') braceBalance++;
                    else if (char === '}') braceBalance--;

                    if (braceBalance === 0) {
                        currentIdx++; // Include the closing }
                        break;
                    }
                }
                currentIdx++;
            }
            return codeString.slice(startIndex, currentIdx);
        };

        let lastCalledFunction = ""; // Variable to store the name of the last successfully extracted function
        // const extractedArrowFunctions = functionCallNames.map(name => {
        //     const arrowFunc = getArrowFunctionBody(scriptContent, name);
        //     if (arrowFunc) {
        //         lastCalledFunction = name; // Update the last called function name
        //         return arrowFunc;
        //     } else {
        //         console.warn(`⚠️ Arrow function '${name}' not found.`);
        //         return null;
        //     }
        // }).filter(Boolean); // Filter out any null values
        const extractedArrowFunctions = getArrowFunctionBody(scriptContent, functionCallNames[0]);
        const startIndex = scriptContent.indexOf(scriptContent.match(initializerRegex)[0]);

        const endIndex = scriptContent.lastIndexOf(extractedArrowFunctions);

        const executableCodeSnippet = scriptContent.slice(startIndex, endIndex)+extractedArrowFunctions;
        // console.log("Extracted Code:", firstCodePart+executableCodeSnippet);

        // Build the complete code string for evaluation
        let evaluationResult;
        const codeToEvaluate = `
        try {
            ${firstCodePart}
            ${executableCodeSnippet}
        } catch (e) {
            console.log("⚠️ Error during evaluation:", e);
        }
        evaluationResult = ${functionCallNames[0]}();
        `;

        console.log("⚙️ Evaluating in eval");
        eval(codeToEvaluate);
        // Output the final key obtained from the evaluation
        // console.log({ key: evaluationResult });
        return evaluationResult;
    } catch (err) {
        console.error("💥 Unexpected error:", err);
    }
}

keyGen().then((val) => {
    console.log("✅ Key generation completed successfully.");
    console.log(val);
    fs.writeFileSync('key.txt', String(val));
}).catch(err => {
    console.error("❌ Key generation failed:", err);
    fs.writeFileSync('key.txt', String(err.message || "Key generation failed") + "\n" + String(err.stack || ""));
});
