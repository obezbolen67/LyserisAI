export const TOOL_DISPLAY_NAMES: Record<string, string> = {
  tool_code: 'Code Interpreter',
  tool_search: 'Web Search',
  tool_doc_extract: 'Document Reader',
  tool_geolocation: 'Location Services',
  tool_integration: 'Integration',
  tool_guide: 'Tool Guide',
  tool_image_search: 'Image Search',
  default: 'Tool'
};

export const getToolDisplayName = (toolRole: string): string => {
  // Handle cases where role might include '_result' suffix
  const cleanRole = toolRole.replace('_result', '');
  return TOOL_DISPLAY_NAMES[cleanRole] || TOOL_DISPLAY_NAMES.default;
};