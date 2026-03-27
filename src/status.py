from termcolor import colored

# Lazy import to avoid circular dependency at module load time
def _push(level: str, message: str) -> None:
    try:
        from api.log_stream import add_log  # noqa: PLC0415
        add_log(level, message)
    except Exception:
        pass  # Never crash if log_stream not available (e.g. CLI mode)


def error(message: str, show_emoji: bool = True) -> None:
    emoji = "❌" if show_emoji else ""
    print(colored(f"{emoji} {message}", "red"))
    _push("error", f"{emoji} {message}")

def success(message: str, show_emoji: bool = True) -> None:
    emoji = "✅" if show_emoji else ""
    print(colored(f"{emoji} {message}", "green"))
    _push("success", f"{emoji} {message}")

def info(message: str, show_emoji: bool = True) -> None:
    emoji = "ℹ️" if show_emoji else ""
    print(colored(f"{emoji} {message}", "magenta"))
    _push("info", f"{emoji} {message}")

def warning(message: str, show_emoji: bool = True) -> None:
    emoji = "⚠️" if show_emoji else ""
    print(colored(f"{emoji} {message}", "yellow"))
    _push("warning", f"{emoji} {message}")

def question(message: str, show_emoji: bool = True) -> str:
    emoji = "❓" if show_emoji else ""
    return input(colored(f"{emoji} {message}", "magenta"))

