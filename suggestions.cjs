// Applying suggestions locally (no API call): copied from the engine (api/src/engine/core/index.cjs), keep them in step.
const countOccurrences = (text, searchString) => {
  if (!searchString || searchString === "") return 0;
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(searchString, pos)) !== -1) {
    count++;
    pos += searchString.length;
  }
  return count;
};
const truncate = (str, maxLength) => {
  if (!str) return "";
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength) + "...";
};
function resolveDependencyOrder(suggestions) {
  const graph = new Map();
  const inDegree = new Map();

  for (const suggestion of suggestions) {
    graph.set(suggestion.id, []);
    inDegree.set(suggestion.id, 0);
  }

  for (const suggestion of suggestions) {
    if (suggestion.depends_on && suggestion.depends_on.trim() !== "") {
      const deps = suggestion.depends_on.split(",").map((d) => d.trim());
      for (const depId of deps) {
        if (graph.has(depId)) {
          graph.get(depId).push(suggestion.id);
          inDegree.set(suggestion.id, inDegree.get(suggestion.id) + 1);
        }
      }
    }
  }

  const queue = [];
  const result = [];

  for (const [id, degree] of inDegree.entries()) {
    if (degree === 0) queue.push(id);
  }

  while (queue.length > 0) {
    const current = queue.shift();
    result.push(current);

    for (const dependent of graph.get(current)) {
      inDegree.set(dependent, inDegree.get(dependent) - 1);
      if (inDegree.get(dependent) === 0) {
        queue.push(dependent);
      }
    }
  }

  if (result.length !== suggestions.length) {
    return {
      success: false,
      error: "Circular dependency detected",
      orderedSuggestions: [],
    };
  }

  const orderedSuggestions = result.map((id) => suggestions.find((s) => s.id === id));

  return {
    success: true,
    orderedSuggestions,
  };
}

/**
 * Generate suggestions for text or code improvements
 * @param {Object} config
 * @param {string} config.prompt - User's request + content to analyze
 * @param {string} config.model - Model key
 * @param {number} [config.maxTokens=4000] - Maximum tokens
 * @param {boolean} [config.enableThinking=true] - Enable extended thinking
 * @param {number} [config.thinkingTokens=5000] - Thinking tokens
 * @returns {Promise<Object>} Parsed suggestions
 */
const generateSuggestions = async (config) => {
  const { prompt, model, maxTokens = 4000, enableThinking = true, thinkingTokens = 5000 } = config;

  if (!prompt) {
    return {
      success: false,
      error: "Prompt is required",
      suggestions: [],
    };
  }

  try {
    const finalPrompt = `${prompt}\n\n${SUGGESTIONS_SYSTEM_PROMPT}`;

    const result = await generateText({
      ...pickProviderOptions(config),
      prompt: finalPrompt,
      model,
      maxTokens,
      enableThinking,
      thinkingTokens,
    });

    if (result.error) return { suggestions: [], ...result };

    const suggestions = parseXMLSuggestions(result.data);

    return {
      success: true,
      suggestions,
      ...result,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      suggestions: [],
    };
  }
};

/**
 * Apply selected suggestions to original text
 * @param {Object} config
 * @param {string} config.text - Original text
 * @param {Array} config.suggestions - Suggestions to apply
 * @param {boolean} [config.validateUniqueness=true] - Check uniqueness
 * @param {boolean} [config.strict=false] - Throw on any failure
 * @param {boolean} [config.handleDependencies=true] - Resolve dependencies
 * @returns {Object} Result with corrected text and report
 */
const applySuggestions = (config) => {
  const { text, suggestions, validateUniqueness = true, strict = false, handleDependencies = true } = config;

  if (!text) {
    return {
      success: false,
      error: "Text is required",
      correctedText: text,
      applied: [],
      failed: [],
      skipped: [],
    };
  }

  if (!suggestions || !Array.isArray(suggestions) || suggestions.length === 0) {
    return {
      success: true,
      correctedText: text,
      applied: [],
      failed: [],
      skipped: [],
      message: "No suggestions to apply",
    };
  }

  let orderedSuggestions = suggestions;
  if (handleDependencies) {
    const result = resolveDependencyOrder(suggestions);
    if (!result.success) {
      return {
        success: false,
        error: result.error,
        correctedText: text,
        applied: [],
        failed: [],
        skipped: [],
      };
    }
    orderedSuggestions = result.orderedSuggestions;
  }

  let correctedText = text;
  const applied = [];
  const failed = [];
  const skipped = [];

  for (const suggestion of orderedSuggestions) {
    const { from, to, id, label, type, confidence, depends_on } = suggestion;

    if (!from || from.trim() === "") {
      failed.push({
        ...suggestion,
        issue: "empty_from_field",
        message: '"from" field is required',
      });
      if (strict) {
        return {
          success: false,
          error: 'Suggestion failed: "from" field required',
          correctedText: text,
          applied,
          failed,
          skipped,
        };
      }
      continue;
    }

    if (depends_on && depends_on.trim() !== "") {
      const deps = depends_on.split(",").map((d) => d.trim());
      const missingDeps = deps.filter((depId) => !applied.find((a) => a.id === depId));

      if (missingDeps.length > 0) {
        skipped.push({
          ...suggestion,
          issue: "missing_dependencies",
          message: `Missing dependencies: ${missingDeps.join(", ")}`,
        });
        continue;
      }
    }

    const occurrences = countOccurrences(correctedText, from);

    if (occurrences === 0) {
      failed.push({
        ...suggestion,
        issue: "not_found",
        message: `String not found: "${truncate(from, 50)}"`,
      });
      if (strict) {
        return {
          success: false,
          error: `Failed: "${truncate(from, 50)}" not found`,
          correctedText: text,
          applied,
          failed,
          skipped,
        };
      }
      continue;
    }

    if (validateUniqueness && occurrences > 1) {
      failed.push({
        ...suggestion,
        issue: "not_unique",
        occurrences,
        message: `String appears ${occurrences} times`,
      });
      if (strict) {
        return {
          success: false,
          error: `Failed: appears ${occurrences} times`,
          correctedText: text,
          applied,
          failed,
          skipped,
        };
      }
      continue;
    }

    correctedText = correctedText.replace(from, () => to);
    applied.push({
      id,
      label,
      type,
      confidence,
      preview: {
        from: truncate(from, 50),
        to: truncate(to, 50),
      },
    });
  }

  return {
    success: failed.length === 0 || !strict,
    correctedText,
    applied,
    failed,
    skipped,
    stats: {
      total: suggestions.length,
      applied: applied.length,
      failed: failed.length,
      skipped: skipped.length,
      successRate: `${Math.round((applied.length / suggestions.length) * 100)}%`,
    },
  };
};
const validateSuggestions = (text, suggestions) => {
  const issues = [];
  const warnings = [];

  for (const suggestion of suggestions) {
    const { id, from, depends_on, conflicts_with } = suggestion;

    if (!from || from.trim() === "") {
      issues.push({
        id,
        type: "empty_from_field",
        message: '"from" field required',
      });
    }

    if (from && from.trim() !== "" && !text.includes(from)) {
      issues.push({
        id,
        type: "not_found",
        message: `"from" not found: "${truncate(from, 50)}"`,
      });
    }

    if (from && from.trim() !== "") {
      const count = countOccurrences(text, from);
      if (count > 1) {
        warnings.push({
          id,
          type: "duplicate",
          message: `"from" appears ${count} times`,
        });
      }
    }

    if (depends_on && depends_on.trim() !== "") {
      const deps = depends_on.split(",").map((d) => d.trim());
      for (const depId of deps) {
        if (!suggestions.find((s) => s.id === depId)) {
          issues.push({
            id,
            type: "missing_dependency",
            message: `Depends on non-existent: ${depId}`,
          });
        }
      }
    }

    if (conflicts_with && conflicts_with.trim() !== "") {
      const conflicts = conflicts_with.split(",").map((c) => c.trim());
      for (const conflictId of conflicts) {
        if (!suggestions.find((s) => s.id === conflictId)) {
          warnings.push({
            id,
            type: "missing_conflict_reference",
            message: `Conflicts with non-existent: ${conflictId}`,
          });
        }
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings,
  };
};

module.exports = { applySuggestions, validateSuggestions };
