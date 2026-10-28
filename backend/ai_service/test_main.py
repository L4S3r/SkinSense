import unittest

from fastapi import HTTPException

from main import validate_report


class ValidateReportTests(unittest.TestCase):
    def setUp(self):
        self.report = {
            "skin_type": " OILY ",
            "confidence": "high",
            "summary": "The visible skin characteristics appear balanced overall.",
            "concerns": [],
            "observations": [{"label": "Texture", "detail": "Texture appears smooth."}],
            "care_tips": ["Use a gentle cleanser."],
            "caveats": "This is a cosmetic assessment only.",
        }

    def test_normalizes_supported_skin_type(self):
        report = validate_report(self.report)

        self.assertEqual(report.skin_type.value, "oily")

    def test_rejects_unsupported_skin_type_with_502(self):
        self.report["skin_type"] = "oily skin"

        with self.assertRaises(HTTPException) as context:
            validate_report(self.report)

        self.assertEqual(context.exception.status_code, 502)


if __name__ == "__main__":
    unittest.main()
