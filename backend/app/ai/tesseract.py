"""Lecture du texte avec le binaire Tesseract (local, gratuit)."""

import io
import shutil
import subprocess

from PIL import Image, ImageFilter, ImageOps

from app.ai.base import AiUnavailable

MIN_SIDE = 1600
TIMEOUT_S = 60


def preprocess(image: Image.Image) -> Image.Image:
    """Niveaux de gris, contraste étalé, agrandissement des petites photos (les marquages de
    composants sont minuscules), léger renforcement des contours."""
    img = ImageOps.grayscale(image)
    img = ImageOps.autocontrast(img, cutoff=1)
    side = max(img.size)
    if side < MIN_SIDE:
        factor = MIN_SIDE / side
        img = img.resize((round(img.width * factor), round(img.height * factor)), Image.LANCZOS)
    return img.filter(ImageFilter.SHARPEN)


class TesseractOcr:
    name = "tesseract"

    def __init__(self, cmd: str, lang: str) -> None:
        self.cmd = cmd
        self.lang = lang

    def available(self) -> bool:
        return shutil.which(self.cmd) is not None

    def ocr(self, image: Image.Image) -> str:
        if not self.available():
            raise AiUnavailable("Lecture du texte indisponible : Tesseract n'est pas installé.")
        buf = io.BytesIO()
        preprocess(image).save(buf, format="PNG")
        try:
            # --psm 11 : texte épars, sans hypothèse de mise en page (étiquettes, boîtiers).
            proc = subprocess.run(
                [self.cmd, "stdin", "stdout", "-l", self.lang, "--psm", "11"],
                input=buf.getvalue(),
                capture_output=True,
                timeout=TIMEOUT_S,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise AiUnavailable("La lecture du texte a échoué.") from exc
        if proc.returncode != 0:
            raise AiUnavailable("La lecture du texte a échoué.")
        return proc.stdout.decode("utf-8", errors="replace")
