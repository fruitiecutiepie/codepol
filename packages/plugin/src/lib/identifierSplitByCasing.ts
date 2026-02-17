/**
 * Splits a symbol name into words based on camelCase, PascalCase, and snake_case.
 * Handles acronyms: "XMLParser" → ["xml", "parser"], "IOData" → ["io", "data"]
 *
 * @example
 * identifierSplitByCasing("dataStore") // ["data", "store"]
 * identifierSplitByCasing("XMLParser") // ["xml", "parser"]
 * identifierSplitByCasing("user_data") // ["user", "data"]
 * identifierSplitByCasing("database")  // ["database"]
 */
export function identifierSplitByCasing(identifier: string): string[] {
  return identifier
    // Handle acronyms: "XMLParser" → "XML_Parser"
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    // Handle camelCase: "dataStore" → "data_Store"
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[_\-]+/)
    .filter(s => s.length > 0);
}
