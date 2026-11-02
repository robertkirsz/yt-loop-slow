// Toolbar button and keyboard command both toggle the panel in the active tab.
function togglePanel(tab) {
  if (!tab || tab.id == null) return;
  chrome.tabs.sendMessage(tab.id, { type: 'toggle-panel' }).catch(() => {
    // Not a YouTube tab, or the tab was opened before the extension loaded.
  });
}

chrome.action.onClicked.addListener(togglePanel);

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-panel') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  togglePanel(tab);
});
