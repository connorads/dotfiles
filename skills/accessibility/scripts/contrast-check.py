#!/usr/bin/env python3
"""
WCAG 2.x contrast ratio checker for two hex colours.

Usage:
    python scripts/contrast-check.py '#333333' '#ffffff'
    python scripts/contrast-check.py 333 fff
    python scripts/contrast-check.py '#777777' '#ffffff' --target large-text
"""

import argparse
import json
import sys


TARGETS = {
    "normal-text": ("AA normal text", 4.5),
    "large-text": ("AA large text", 3.0),
    "ui-component": ("AA UI component", 3.0),
    "aaa-normal-text": ("AAA normal text", 7.0),
    "aaa-large-text": ("AAA large text", 4.5),
}


def hex_to_rgb(hex_colour):
    value = hex_colour.strip().lstrip("#")
    if len(value) == 3:
        value = "".join(channel * 2 for channel in value)
    if len(value) != 6:
        raise ValueError(f"Invalid hex colour: {hex_colour}")
    try:
        return tuple(int(value[index : index + 2], 16) for index in (0, 2, 4))
    except ValueError as error:
        raise ValueError(f"Invalid hex colour: {hex_colour}") from error


def linearise(channel):
    channel = channel / 255.0
    return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4


def relative_luminance(rgb):
    red, green, blue = (linearise(channel) for channel in rgb)
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue


def contrast_ratio(foreground, background):
    fg_luminance = relative_luminance(hex_to_rgb(foreground))
    bg_luminance = relative_luminance(hex_to_rgb(background))
    lighter = max(fg_luminance, bg_luminance)
    darker = min(fg_luminance, bg_luminance)
    return (lighter + 0.05) / (darker + 0.05)


def compliance(ratio):
    return {
        "ratio": ratio,
        "aa_normal_text": ratio >= 4.5,
        "aa_large_text": ratio >= 3.0,
        "aa_ui_components": ratio >= 3.0,
        "aaa_normal_text": ratio >= 7.0,
        "aaa_large_text": ratio >= 4.5,
    }


def parse_args():
    parser = argparse.ArgumentParser(description="Check WCAG contrast for two hex colours.")
    parser.add_argument("foreground", help="Foreground/text colour, for example '#333333'")
    parser.add_argument("background", help="Background colour, for example '#ffffff'")
    parser.add_argument(
        "--target",
        choices=sorted(TARGETS),
        default="normal-text",
        help="Requirement to use for pass/fail exit status (default: normal-text)",
    )
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON")
    return parser.parse_args()


def target_result(target, ratio):
    label, threshold = TARGETS[target]
    return {
        "target": target,
        "target_label": label,
        "threshold": threshold,
        "passed": ratio >= threshold,
    }


def print_text(foreground, background, result, selected):
    ratio = result["ratio"]
    print(f"Foreground: {foreground}")
    print(f"Background: {background}")
    print(f"Contrast ratio: {ratio:.4f}:1")
    print(
        f"Selected target: {selected['target_label']}, "
        f"{selected['threshold']:g}:1: {'PASS' if selected['passed'] else 'FAIL'}"
    )
    print()
    print("WCAG AA")
    print(f"- Normal text, 4.5:1: {'PASS' if result['aa_normal_text'] else 'FAIL'}")
    print(f"- Large text, 3:1: {'PASS' if result['aa_large_text'] else 'FAIL'}")
    print(f"- UI components, 3:1: {'PASS' if result['aa_ui_components'] else 'FAIL'}")
    print()
    print("WCAG AAA")
    print(f"- Normal text, 7:1: {'PASS' if result['aaa_normal_text'] else 'FAIL'}")
    print(f"- Large text, 4.5:1: {'PASS' if result['aaa_large_text'] else 'FAIL'}")
    if not selected["passed"]:
        print()
        print("Recommendation: adjust the colours; do not round near misses up to passing.")


def main():
    args = parse_args()
    try:
        ratio = contrast_ratio(args.foreground, args.background)
        result = compliance(ratio)
        selected = target_result(args.target, ratio)
    except ValueError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 2

    if args.json:
        print(
            json.dumps(
                {
                    "foreground": args.foreground,
                    "background": args.background,
                    **selected,
                    **result,
                },
                indent=2,
                sort_keys=True,
            )
        )
    else:
        print_text(args.foreground, args.background, result, selected)

    return 0 if selected["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
