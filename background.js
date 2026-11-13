chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((message) => {
  if (message === 'open-options') chrome.runtime.openOptionsPage();
});
