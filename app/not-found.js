import Link from "next/link";

export default function NotFound() {
  return (
    <div style={{ padding: 60, maxWidth: 520 }}>
      <h1>Page not found</h1>
      <p className="muted" style={{ margin: "10px 0 20px" }}>The page you asked for does not exist or was moved.</p>
      <Link className="btn" href="/">Go to my dashboard</Link>
    </div>
  );
}
