---
name: pdf-forms
description: Fills and flattens PDF form fields with pypdf. Use when filling in a PDF form, listing a form's fields, or flattening a filled form so it can't be edited.
---

# PDF Forms

Fill AcroForm fields with `pypdf`. Scanned PDFs have no fields; they need OCR,
which this skill does not cover.

## List fields

```python
from pypdf import PdfReader
print(PdfReader("form.pdf").get_fields().keys())
```

## Fill and flatten

1. Read the field names first; labels on the page rarely match them.
2. Fill with `writer.update_page_form_field_values(page, values, auto_regenerate=False)`.
3. Flatten by removing the `/AcroForm` entry only after checking the output renders.

Checkbox values are the field's export value (often `/Yes`), not `True`.
