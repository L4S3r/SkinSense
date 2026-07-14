// =====================================================
// Lumen Capture — booth phone app
// Front-camera capture station. Takes a photo and POSTs it to the Lumen
// backend, which analyzes it and pushes the report to the booth screen.
// This phone only confirms "sent" — the report shows on the big screen.
// =====================================================

import 'dart:convert';
import 'dart:typed_data';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

// ---- Palette (mirrors the web app's design tokens) ----
const _bg = Color(0xFF12151A);
const _bgRaised = Color(0xFF1A1E26);
const _coral = Color(0xFFE8998D);
const _teal = Color(0xFF5EEAD4);
const _text = Color(0xFFF5F3F0);
const _textMuted = Color(0xFF8B92A0);

List<CameraDescription> _cameras = <CameraDescription>[];

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  try {
    _cameras = await availableCameras();
  } catch (_) {
    _cameras = <CameraDescription>[];
  }
  runApp(const LumenCaptureApp());
}

class LumenCaptureApp extends StatelessWidget {
  const LumenCaptureApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Lumen Capture',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: _bg,
        colorScheme: const ColorScheme.dark(
          primary: _teal,
          secondary: _coral,
          surface: _bgRaised,
        ),
        useMaterial3: true,
      ),
      home: const CaptureScreen(),
    );
  }
}

enum SendState { idle, sending, sent, error }

class CaptureScreen extends StatefulWidget {
  const CaptureScreen({super.key});

  @override
  State<CaptureScreen> createState() => _CaptureScreenState();
}

class _CaptureScreenState extends State<CaptureScreen> {
  CameraController? _controller;
  Future<void>? _initFuture;
  SendState _state = SendState.idle;
  String _message = '';
  String _host = '192.168.1.2:3000'; // sensible booth default; editable
  // Which lens is live. Start on the front (selfie) camera for a face scan.
  CameraLensDirection _lens = CameraLensDirection.front;

  static const _hostKey = 'lumen_host';

  @override
  void initState() {
    super.initState();
    _loadHost();
    _initCamera(_lens);
  }

  // True when the device actually has both a front and a rear camera —
  // no point showing the switch button on a single-camera device.
  bool get _canSwitchCamera {
    final hasFront =
        _cameras.any((c) => c.lensDirection == CameraLensDirection.front);
    final hasBack =
        _cameras.any((c) => c.lensDirection == CameraLensDirection.back);
    return hasFront && hasBack;
  }

  Future<void> _loadHost() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(_hostKey);
    if (saved != null && saved.isNotEmpty && mounted) {
      setState(() => _host = saved);
    }
  }

  Future<void> _saveHost(String host) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_hostKey, host);
  }

  void _initCamera(CameraLensDirection lens) {
    if (_cameras.isEmpty) return;
    // Pick the requested lens, falling back to whatever the device has.
    final camera = _cameras.firstWhere(
      (c) => c.lensDirection == lens,
      orElse: () => _cameras.first,
    );
    _lens = camera.lensDirection;
    final controller = CameraController(
      camera,
      ResolutionPreset.high,
      enableAudio: false,
    );
    _controller = controller;
    _initFuture = controller.initialize().then((_) {
      if (mounted) setState(() {});
    });
  }

  // Flip between front and rear cameras. Disposes the old controller first so
  // we don't leak the camera, and blocks while a scan is in flight.
  Future<void> _switchCamera() async {
    if (!_canSwitchCamera || _state == SendState.sending) return;
    final next = _lens == CameraLensDirection.front
        ? CameraLensDirection.back
        : CameraLensDirection.front;
    final old = _controller;
    _controller = null;
    setState(() {}); // show the spinner while the new lens spins up
    await old?.dispose();
    _initCamera(next);
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  Future<void> _captureAndSend() async {
    final controller = _controller;
    if (controller == null || !controller.value.isInitialized) return;
    if (_state == SendState.sending) return;

    setState(() {
      _state = SendState.sending;
      _message = 'Analyzing…';
    });

    try {
      final XFile shot = await controller.takePicture();
      final Uint8List bytes = await shot.readAsBytes();
      final String dataUrl = 'data:image/jpeg;base64,${base64Encode(bytes)}';

      final uri = Uri.parse('http://$_host/api/analyze');
      final res = await http
          .post(
            uri,
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({'image': dataUrl}),
          )
          .timeout(const Duration(seconds: 45));

      if (res.statusCode == 200) {
        setState(() {
          _state = SendState.sent;
          _message = 'Sent! Check the screen →';
        });
        // Auto-reset so the next person can scan.
        Future.delayed(const Duration(seconds: 4), () {
          if (mounted && _state == SendState.sent) {
            setState(() => _state = SendState.idle);
          }
        });
      } else {
        String err = 'Server error (${res.statusCode}).';
        try {
          final body = jsonDecode(res.body);
          if (body is Map && body['error'] is String) err = body['error'];
        } catch (_) {}
        setState(() {
          _state = SendState.error;
          _message = err;
        });
      }
    } catch (e) {
      setState(() {
        _state = SendState.error;
        _message = 'Could not reach the server. Check the address and Wi-Fi.';
      });
    }
  }

  Future<void> _editHost() async {
    final controller = TextEditingController(text: _host);
    final result = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: _bgRaised,
        title: const Text('Booth server address', style: TextStyle(color: _text)),
        content: TextField(
          controller: controller,
          autofocus: true,
          style: const TextStyle(color: _text),
          decoration: const InputDecoration(
            hintText: 'e.g. 192.168.1.2:3000',
            hintStyle: TextStyle(color: _textMuted),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel', style: TextStyle(color: _textMuted)),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: const Text('Save', style: TextStyle(color: _teal)),
          ),
        ],
      ),
    );
    if (result != null && result.isNotEmpty) {
      setState(() => _host = result);
      await _saveHost(result);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: _bg,
        title: const Text('Lumen Capture', style: TextStyle(color: _text, fontSize: 18)),
        actions: [
          TextButton.icon(
            onPressed: _editHost,
            icon: const Icon(Icons.settings, size: 18, color: _textMuted),
            label: Text(_host, style: const TextStyle(color: _textMuted, fontSize: 12)),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(child: _buildPreview()),
          _buildControls(),
        ],
      ),
    );
  }

  Widget _buildPreview() {
    if (_cameras.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'No camera available on this device.',
            style: TextStyle(color: _textMuted),
            textAlign: TextAlign.center,
          ),
        ),
      );
    }
    return FutureBuilder<void>(
      future: _initFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done ||
            _controller == null ||
            !_controller!.value.isInitialized) {
          return const Center(child: CircularProgressIndicator(color: _teal));
        }
        final isFront = _lens == CameraLensDirection.front;
        return Stack(
          alignment: Alignment.center,
          fit: StackFit.expand,
          children: [
            // Mirror only the front camera so it feels natural, like a selfie.
            // The rear camera is shown un-mirrored (what you point it at).
            Transform(
              alignment: Alignment.center,
              transform: isFront
                  ? Matrix4.rotationY(3.1415926535)
                  : Matrix4.identity(),
              child: CameraPreview(_controller!),
            ),
            _buildFaceGuide(),
            if (_canSwitchCamera)
              Positioned(
                top: 16,
                right: 16,
                child: _CameraSwitchButton(
                  onPressed:
                      _state == SendState.sending ? null : _switchCamera,
                ),
              ),
            if (_state == SendState.sending)
              Container(
                color: Colors.black54,
                child: const Center(
                  child: CircularProgressIndicator(color: _teal),
                ),
              ),
          ],
        );
      },
    );
  }

  Widget _buildFaceGuide() {
    return IgnorePointer(
      child: Center(
        child: FractionallySizedBox(
          widthFactor: 0.6,
          heightFactor: 0.7,
          child: Container(
            decoration: BoxDecoration(
              border: Border.all(color: _teal.withValues(alpha: 0.5), width: 1.4),
              borderRadius: BorderRadius.circular(140),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildControls() {
    final bool sending = _state == SendState.sending;
    final Color msgColor = switch (_state) {
      SendState.error => _coral,
      SendState.sent => _teal,
      _ => _textMuted,
    };

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(24, 20, 24, 32),
      color: _bg,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_message.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: Text(
                _message,
                textAlign: TextAlign.center,
                style: TextStyle(color: msgColor, fontSize: 15),
              ),
            ),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: sending ? null : _captureAndSend,
              style: ElevatedButton.styleFrom(
                backgroundColor: _coral,
                foregroundColor: _bg,
                disabledBackgroundColor: _bgRaised,
                padding: const EdgeInsets.symmetric(vertical: 18),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
              child: Text(
                sending ? 'Analyzing…' : 'Capture & send',
                style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Round "flip camera" button overlaid on the preview.
class _CameraSwitchButton extends StatelessWidget {
  const _CameraSwitchButton({required this.onPressed});

  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.black54,
      shape: const CircleBorder(),
      clipBehavior: Clip.antiAlias,
      child: IconButton(
        onPressed: onPressed,
        tooltip: 'Switch camera',
        icon: const Icon(Icons.cameraswitch, color: _text),
        iconSize: 26,
        padding: const EdgeInsets.all(12),
      ),
    );
  }
}
