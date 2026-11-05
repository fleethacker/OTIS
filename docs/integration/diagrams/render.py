#!/usr/bin/env python3
"""Render self-contained architecture SVGs with the Python standard library.

Run from any directory. --check verifies outputs without writing them.
Product marks are local Simple Icons assets; see icons/README.md.
"""
from __future__ import annotations

import argparse
from html import escape
from pathlib import Path
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
SVG = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG)
ICONS = ("react", "typescript", "nginx", "rust", "opensearch", "onnx",
         "kubernetes", "istio", "keycloak", "docker")
STYLE = """
text { font-family: Inter, Arial, sans-serif; fill: #183745; }
.title { font-size: 32px; font-weight: 600; letter-spacing: -.5px; }
.subtitle { font-size: 22px; fill: #506975; }
.layer-title { font-size: 23px; font-weight: 600; letter-spacing: 1.2px; }
.node-title { font-size: 24px; font-weight: 600; }
.body { font-size: 21px; }
.small { font-size: 20px; fill: #506975; }
.label { font-size: 20px; font-weight: 500; }
.white { fill: #ffffff; }
.light { fill: #d8e7ed; }
.layer { fill: #ffffff; stroke: #c8d7de; stroke-width: 1.5; }
.platform { fill: #eaf3f4; stroke: #aec9ce; stroke-width: 1.5; }
.foundation { fill: #183745; }
.node { fill: #ffffff; stroke: #a9bdc7; stroke-width: 1.5; }
.rule { fill: none; stroke: #c8d7de; stroke-width: 1.5; }
.runtime { fill: none; stroke: #087f8c; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.identity { fill: none; stroke: #79609c; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.delivery { fill: none; stroke: #627b88; stroke-width: 2; stroke-dasharray: 7 7; stroke-linejoin: round; }
"""


def text(x: int, y: int, value: str, css: str = "body", anchor: str = "start") -> str:
    return f'<text x="{x}" y="{y}" class="{css}" text-anchor="{anchor}">{escape(value)}</text>'


def rect(x: int, y: int, width: int, height: int, css: str) -> str:
    return f'<rect x="{x}" y="{y}" width="{width}" height="{height}" rx="12" class="{css}"/>'


def icon(name: str, x: int, y: int, size: int = 42, color: str = "#183745") -> str:
    return (f'<use href="#icon-{name}" x="{x}" y="{y}" width="{size}" '
            f'height="{size}" fill="{color}" aria-hidden="true"/>')


def link(path: str, kind: str = "runtime", both: bool = False) -> str:
    start = f' marker-start="url(#{kind}-arrow)"' if both else ""
    return f'<path d="{path}" class="{kind}" marker-end="url(#{kind}-arrow)"{start}/>'


def definitions() -> str:
    parts = ["<defs>"]
    for name in ICONS:
        source = ET.parse(HERE / "icons" / f"{name}.svg").getroot()
        children = "".join(ET.tostring(child, encoding="unicode") for child in source)
        parts.append(f'<symbol id="icon-{name}" viewBox="{source.attrib["viewBox"]}">{children}</symbol>')
    for kind, color in (("runtime", "#087f8c"), ("identity", "#79609c"), ("delivery", "#627b88")):
        parts.append(
            f'<marker id="{kind}-arrow" orient="auto-start-reverse" markerUnits="userSpaceOnUse" '
            f'refX="10" refY="6" markerWidth="12" markerHeight="12">'
            f'<path d="M2 2L10 6 2 10" fill="none" stroke="{color}" '
            'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></marker>'
        )
    return "\n".join(parts) + "\n</defs>"


def header(uds: bool) -> str:
    title = "OTIS on UDS Core" if uds else "OTIS local Compose stack"
    subtitle = ("Applications above platform services; Kubernetes provides the foundation."
                if uds else "Application and mailbox projects share a local container runtime.")
    parts = [text(48, 48, title, "title"), text(48, 82, subtitle, "subtitle")]
    for x, kind, label in ((48, "runtime", "Runtime data"), (300, "identity", "Native OIDC"),
                           (560, "delivery", "Deployment")):
        if not uds and kind == "identity":
            continue
        parts += [link(f"M{x} 110h36", kind), text(x + 48, 117, label, "small")]
    return "\n".join(parts)


def external_nodes(uds: bool) -> str:
    parts = [rect(88, 140, 320, 126, "node"), icon("react", 110, 159, 40, "#087f8c"),
             icon("typescript", 156, 168, 24, "#3178c6"), text(194, 185, "Watchstander", "node-title"),
             text(110, 225, "React / TypeScript browser", "small"), rect(480, 140, 320, 126, "node"),
             text(502, 181, "UDS CLI + Zarf" if uds else "Docker Compose", "node-title"),
             text(502, 218, "Images · charts · local model" if uds else "Build / start prepared images", "small"),
             text(502, 245, "Install into existing cluster" if uds else "Provision local model", "small"),
             rect(872, 140, 320, 126, "node")]
    # The mailbox is supplied; do not imply a specific branded mail product.
    parts += ['<g aria-hidden="true"><path d="M896 163h40v28h-40Z M896 163l20 15 20-15" '
              'fill="none" stroke="#183745" stroke-width="2" stroke-linejoin="round"/></g>',
              text(950, 185, "Enclave mailbox" if uds else "Demo mailbox", "node-title"),
              text(894, 223, "External · SMTP upstream" if uds else "Separate mail Compose project", "small"),
              text(894, 249, "IMAPS :993 · verified TLS" if uds else "SMTP :1025 · IMAP :1143", "small"),
              link("M640 128H1254V548H1244", "delivery")]
    return "\n".join(parts)


def application(uds: bool) -> str:
    parts = [rect(48, 322, 1184, 386, "layer"), text(88, 359, "OTIS APPLICATION", "layer-title"),
             text(1192, 359, "Kubernetes namespace" if uds else "Application Compose project", "small", "end")]
    nodes = ((88, "nginx", "React + Nginx", "Static UI + same-origin proxy", "web :8080", "JSON API + ConnectRPC"),
             (480, "rust", "Rust server", "Axum · Tokio · ConnectRPC", "IMAP → OPTASK → outbox",
              "Typed APIs · native OIDC" if uds else "Typed APIs · local demo auth"),
             (872, "opensearch", "OpenSearch 3.9", "BM25 + vector → hybrid RRF",
              "MiniLM · ONNX · CPU · 384-D", "Messages · passages · audit"))
    for x, brand, title, first, second, third in nodes:
        parts += [rect(x, 399, 320, 174, "node"), icon(brand, x + 22, 419),
                  text(x + 82, 449, title, "node-title"), text(x + 22, 485, first, "small"),
                  text(x + 22, 517, second, "small"), text(x + 22, 549, third, "small")]
    parts += [link("M420 486H468", both=True), text(444, 469, "API", "label", "middle"),
              text(444, 517, "8081", "small", "middle"), link("M812 486H860", both=True),
              text(836, 469, "REST", "label", "middle"), text(836, 517, "9200", "small", "middle"),
              text(480, 615, "Receipt → parse → publish", "small"),
              text(480, 645, "Custody / replayable outbox", "small"),
              text(480, 675, "Private drafts remain unsent", "small"),
              '<path d="M1032 585v16" class="rule"/>',
              '<path d="M872 621v37c0 22 320 22 320 0v-37" class="node"/>',
              '<ellipse cx="1032" cy="621" rx="160" ry="11" fill="#eaf0f3" stroke="#a9bdc7" stroke-width="1.5"/>',
              text(1032, 654, "Retained search PVC" if uds else "opensearch-data volume", "label", "middle"),
              text(1032, 694, "Search · custody · private state", "small", "middle"),
              link("M1032 278V304H640V387"),
              text(836, 296, "IMAPS :993" if uds else "IMAP :143 · read-only", "label", "middle")]
    if uds:
        parts += [link("M76 204H26V850H98"), text(38, 311, "HTTPS", "label"),
                  link("M388 795V585"), text(402, 739, "Ingress route", "label"),
                  link("M776 585V731H1032V816", "identity", both=True),
                  text(904, 723, "OIDC + PKCE", "label", "middle")]
    else:
        parts += [link("M380 278V387"), text(392, 313, "HTTP :8080", "label")]
    return "\n".join(parts)


def platform(uds: bool) -> str:
    if uds:
        parts = [rect(48, 759, 1184, 160, "platform"),
                 text(640, 792, "UDS CORE 1.14.3 · PLATFORM", "layer-title", "middle"),
                 icon("istio", 110, 828, 42, "#476489"), text(166, 850, "Istio", "node-title"),
                 text(166, 880, "Ingress + sidecar mTLS", "small"),
                 text(502, 850, "Pepr / UDS Operator", "node-title"),
                 text(502, 880, "Package · SSO · policies", "small"),
                 icon("keycloak", 894, 828), text(950, 850, "Keycloak", "node-title"),
                 text(950, 880, "OIDC identity + roles", "small"),
                 rect(48, 965, 1184, 108, "foundation"), icon("kubernetes", 88, 996, 46, "#ffffff"),
                 text(154, 1008, "Kubernetes · Linux ARM64", "node-title white"),
                 text(154, 1042, "Scheduling · Services · persistent volumes", "small light"),
                 text(1192, 1008, "FOUNDATION", "layer-title white", "end"),
                 text(48, 1118, "Layers show support. Runtime traffic follows the labeled connectors.", "small"),
                 text(48, 1150, "UDS profile: integrated native OIDC / migration / recovery acceptance pending.", "small")]
    else:
        parts = [rect(48, 759, 1184, 128, "platform"),
                 text(88, 797, "DOCKER COMPOSE · LOCAL DEPLOYMENT", "layer-title"),
                 text(88, 835, "Application network: web / server / OpenSearch", "small"),
                 text(88, 866, "Separate demo mail project and persistent volumes", "small"),
                 text(1192, 835, "Local demo authentication", "small", "end"),
                 text(1192, 866, "Prepared offline model assets", "small", "end"),
                 rect(48, 933, 1184, 108, "foundation"), icon("docker", 88, 964, 50, "#ffffff"),
                 text(154, 976, "Docker Engine · local host", "node-title white"),
                 text(154, 1010, "Containers · bridge networks · named volumes", "small light"),
                 text(1192, 976, "FOUNDATION", "layer-title white", "end"),
                 text(48, 1088, "Link labels use service ports; mailbox host ports appear on the mailbox.", "small"),
                 text(48, 1120, "Compose is the local demo profile. Optional native OIDC uses its separate overlay.", "small")]
    return "\n".join(parts)


def render(uds: bool) -> str:
    name = "UDS" if uds else "Compose"
    description = (
        "Bottom-up layers: Kubernetes foundation, UDS Core platform, OTIS workloads. "
        "Istio supplies ingress and sidecar mTLS; Keycloak supplies native OIDC identity. "
        "Rust retrieves enclave mail with verified TLS IMAP, parses OPTASK and publishes to "
        "OpenSearch with local CPU inference, custody and private state. A retained PVC backs data. "
        "UDS CLI/Zarf installation is separate. Integrated profile acceptance is pending."
        if uds else
        "Bottom-up layers: Docker Engine, two Docker Compose projects, OTIS workloads. "
        "The browser uses Nginx, Rust and OpenSearch. A separate demo mailbox feeds read-only IMAP "
        "to Rust. OpenSearch stores search, custody and private state and runs local CPU inference."
    )
    parts = [f'<svg xmlns="{SVG}" width="1280" height="1180" viewBox="0 0 1280 1180" '
             'role="img" aria-labelledby="title description">',
             f'<title id="title">OTIS {name} architecture: foundation to application</title>',
             f'<desc id="description">{escape(description)}</desc>',
             '<!-- Generated by render.py. Product mark provenance: icons/README.md. -->',
             f'<style>{STYLE}</style>', definitions(), '<rect width="1280" height="1180" fill="#f7fafb"/>',
             platform(uds), header(uds), external_nodes(uds), application(uds), '</svg>']
    output = "\n".join(parts) + "\n"
    ET.fromstring(output)
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if diagrams differ from source")
    args = parser.parse_args()
    stale = []
    for name, uds in (("otis-uds.svg", True), ("otis-compose.svg", False)):
        destination = HERE / name
        content = render(uds)
        if args.check:
            if not destination.exists() or destination.read_text(encoding="utf-8") != content:
                stale.append(name)
        else:
            destination.write_text(content, encoding="utf-8")
            print(name)
    if stale:
        parser.error("regenerate diagrams: " + ", ".join(stale))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
