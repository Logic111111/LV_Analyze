// Shared page heading (UI stage 1): the page's group as an eyebrow, its title as the page's one
// <h1>, a one-line description and an optional actions slot. AppShell renders it from lib/nav.js.
export default function PageHeader({ eyebrow, title, desc, actions }) {
  return (
    <div className="page-header">
      <div className="page-header-text">
        {eyebrow && <div className="page-eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {desc && <p className="page-desc">{desc}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
