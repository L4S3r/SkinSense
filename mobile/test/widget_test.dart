// Smoke test for Meloniq Capture.

import 'package:flutter_test/flutter_test.dart';

import 'package:meloniq_capture/main.dart';

void main() {
  testWidgets('App builds and shows the capture button', (WidgetTester tester) async {
    await tester.pumpWidget(const MeloniqCaptureApp());
    await tester.pump();

    // The capture control should be present even with no camera in the test env.
    expect(find.text('Capture & send'), findsOneWidget);
  });
}
