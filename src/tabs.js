export function handleTablistKeydown(event) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = Array.from(event.currentTarget.querySelectorAll('[role="tab"]'));
  if (!tabs.length) return;
  const currentIndex = Math.max(0, tabs.indexOf(event.target));
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? tabs.length - 1
      : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  tabs.forEach((tab, index) => { tab.tabIndex = index === nextIndex ? 0 : -1; });
  tabs[nextIndex].click();
  tabs[nextIndex].focus();
}
