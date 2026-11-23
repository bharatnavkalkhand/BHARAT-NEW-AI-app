#!/usr/bin/env python3
"""
Package the Bharat-AI Pocket Engine workspace into a .tar.gz archive
for Google Colab / Kaggle deployment, excluding node_modules, dist, and secrets.

Usage:
  python3 scripts/export_to_colab.py
  python3 scripts/export_to_colab.py --output bharat-ai-colab.tar.gz
"""

import argparse
import os
import tarfile
from pathlib import Path
from typing import Iterable, Set

DEFAULT_EXCLUDE_DIRS: Set[str] = {
    "node_modules",
    "dist",
    ".git",
    ".aistudio",
    "workspace",
    "__pycache__",
    ".vite",
}

DEFAULT_EXCLUDE_FILES: Set[str] = {
    ".env",
    ".env.local",
    ".DS_Store",
}

DEFAULT_EXCLUDE_SUFFIXES: tuple[str, ...] = (
    ".log",
    ".tar.gz",
    ".tgz",
    ".zip",
)


def should_skip_dir(dir_name: str, extra_excludes: Set[str]) -> bool:
    return dir_name in DEFAULT_EXCLUDE_DIRS or dir_name in extra_excludes


def should_skip_file(
    file_path: Path,
    output_resolved: Path,
    extra_excludes: Set[str],
) -> bool:
    try:
        if file_path.resolve() == output_resolved:
            return True
    except OSError:
        pass

    name = file_path.name
    if name in DEFAULT_EXCLUDE_FILES or name in extra_excludes:
        return True
    if name.endswith(DEFAULT_EXCLUDE_SUFFIXES):
        return True
    return False


def package_project(
    source_dir: Path,
    output_path: Path,
    extra_excludes: Iterable[str] = (),
    config_override: Path | None = None,
    quiet: bool = False,
) -> int:
    source_resolved = source_dir.resolve()
    output_resolved = output_path.resolve()
    output_resolved.parent.mkdir(parents=True, exist_ok=True)
    extra_set = set(extra_excludes)

    file_count = 0
    with tarfile.open(output_resolved, "w:gz") as tar:
        for root, dirs, files in os.walk(source_resolved):
            # Prune excluded directories in-place before descending
            dirs[:] = sorted(
                d for d in dirs if not should_skip_dir(d, extra_set)
            )
            root_path = Path(root)

            for fname in sorted(files):
                fpath = root_path / fname
                if should_skip_file(fpath, output_resolved, extra_set):
                    continue

                rel_path = fpath.relative_to(source_resolved)
                if (
                    config_override is not None
                    and rel_path.as_posix() == "colab_kaggle_gpu/scenes_config.json"
                ):
                    continue

                tar.add(fpath, arcname=rel_path.as_posix(), recursive=False)
                file_count += 1

        if config_override is not None:
            cfg_resolved = config_override.resolve()
            if not cfg_resolved.is_file():
                raise FileNotFoundError(
                    f"Custom scenes config not found: {cfg_resolved}"
                )
            tar.add(
                cfg_resolved,
                arcname="colab_kaggle_gpu/scenes_config.json",
                recursive=False,
            )
            file_count += 1

    if not quiet:
        size_mb = output_resolved.stat().st_size / (1024 * 1024)
        print(
            f"Created {output_resolved} ({file_count} files, {size_mb:.2f} MB)"
        )
    return file_count


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Package the current directory into a .tar.gz archive for "
            "Google Colab / Kaggle, excluding node_modules and dist."
        )
    )
    parser.add_argument(
        "--source",
        type=Path,
        default=Path.cwd(),
        help="Root directory to package (default: current working directory).",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("bharat-ai-pocket-engine-colab.tar.gz"),
        help="Output .tar.gz archive path (default: bharat-ai-pocket-engine-colab.tar.gz).",
    )
    parser.add_argument(
        "--exclude",
        action="append",
        default=[],
        help="Additional directory or file name to exclude (repeatable).",
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=None,
        help="Optional scenes_config.json path to bundle at colab_kaggle_gpu/scenes_config.json.",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Suppress summary output.",
    )
    args = parser.parse_args()

    package_project(
        source_dir=args.source,
        output_path=args.output,
        extra_excludes=args.exclude,
        config_override=args.config,
        quiet=args.quiet,
    )


if __name__ == "__main__":
    main()
