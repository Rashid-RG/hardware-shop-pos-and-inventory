"""Branded Mint wizard pages and real installation milestone protocol.

The Gtk interface runs as the desktop user. Administrative prerequisite
authorization continues to use the existing Zenity / PolicyKit dialogs.
"""
import base64
import re
import subprocess
import time

STAGES = (
    "Preparing permanent runtime storage",
    "Installing locked application dependencies",
    "Building the production application",
    "Downloading and configuring PostgreSQL",
    "Registering services and desktop shortcuts",
)
PREFIX = "ARS_SETUP_STAGE "

def logo_bytes(root):
    source=(root/"src/utils/rsNextwardPrintLogo.ts").read_text()
    match=re.search(r"rsNextwardLogoBase64='([A-Za-z0-9+/=]+)'",source)
    if not match:
        raise RuntimeError("Official RS Nextward setup artwork is missing.")
    data=base64.b64decode(match.group(1),validate=True)
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise RuntimeError("Invalid official setup artwork.")
    return data

def parse_stage(line, completed):
    if not line.startswith(PREFIX):
        return completed
    raw=line[len(PREFIX):].strip()
    if not raw.isascii() or not raw.isdecimal():
        raise RuntimeError("Invalid installation stage signal.")
    stage=int(raw)
    if stage!=completed+1 or stage>len(STAGES):
        raise RuntimeError("Unexpected installation stage sequence.")
    return stage

class SetupUI:
    def __init__(self, root, title):
        import gi
        gi.require_version("Gtk","3.0")
        from gi.repository import Gtk, GdkPixbuf, GLib
        self.Gtk=Gtk
        self.GLib=GLib
        self.title=title
        self.root=root
        loader=GdkPixbuf.PixbufLoader.new_with_type("png")
        loader.write(logo_bytes(root))
        loader.close()
        self.logo=loader.get_pixbuf().scale_simple(245,50,GdkPixbuf.InterpType.BILINEAR)

    def window(self, heading):
        Gtk=self.Gtk
        win=Gtk.Dialog(title=self.title)
        win.set_default_size(650,435)
        win.set_position(Gtk.WindowPosition.CENTER)
        win.set_resizable(False)
        box=win.get_content_area()
        box.set_spacing(14)
        box.set_border_width(24)
        image=Gtk.Image.new_from_pixbuf(self.logo)
        image.set_halign(Gtk.Align.START)
        box.pack_start(image,False,False,0)
        label=Gtk.Label()
        label.set_markup("<span size='x-large' weight='bold'>"+self.GLib.markup_escape_text(heading)+"</span>")
        label.set_xalign(0)
        box.pack_start(label,False,False,0)
        return win,box

    def page(self, heading, message, next_label="Next", agreement=False, cancel="Cancel"):
        Gtk=self.Gtk
        win,box=self.window(heading)
        try:
            body=Gtk.TextView()
            body.set_editable(False)
            body.set_cursor_visible(False)
            body.set_wrap_mode(Gtk.WrapMode.WORD_CHAR)
            body.get_buffer().set_text(message)
            scroll=Gtk.ScrolledWindow()
            scroll.set_policy(Gtk.PolicyType.NEVER,Gtk.PolicyType.AUTOMATIC)
            scroll.add(body)
            box.pack_start(scroll,True,True,0)
            win.add_button(cancel,Gtk.ResponseType.CANCEL)
            button=win.add_button(next_label,Gtk.ResponseType.OK)
            if agreement:
                decline=Gtk.RadioButton.new_with_label_from_widget(None,"I do not accept the installation conditions")
                accept=Gtk.RadioButton.new_with_label_from_widget(decline,"I accept the installation conditions")
                decline.set_active(True)
                button.set_sensitive(False)
                accept.connect("toggled",lambda widget: button.set_sensitive(widget.get_active()))
                box.pack_start(accept,False,False,0)
                box.pack_start(decline,False,False,0)
            win.show_all()
            return win.run()==Gtk.ResponseType.OK and (not agreement or accept.get_active())
        finally:
            win.destroy()
            while Gtk.events_pending():
                Gtk.main_iteration_do(False)

    def install(self):
        Gtk,GLib=self.Gtk,self.GLib
        win,box=self.window("Installing ARS Distributor")
        win.set_deletable(False)
        win.connect("delete-event",lambda *_: True)
        status=Gtk.Label(label=STAGES[0])
        status.set_xalign(0)
        status.set_line_wrap(True)
        box.pack_start(status,False,False,0)
        bar=Gtk.ProgressBar()
        bar.set_show_text(True)
        bar.set_text("0 of 5 stages completed")
        box.pack_start(bar,False,False,0)
        activity=Gtk.ProgressBar()
        box.pack_start(activity,False,False,0)
        elapsed=Gtk.Label(label="Please keep this computer powered on.")
        elapsed.set_xalign(0)
        box.pack_start(elapsed,False,False,0)
        # Read installation output on a separate thread. Only stage signals
        # reach the GUI; command output is not shown or saved with credentials.
        import queue
        import threading
        signals=queue.Queue()
        proc=subprocess.Popen(["bash",str(self.root/"scripts/mint/install.sh")],
                              cwd=self.root,stdout=subprocess.PIPE,
                              stderr=subprocess.STDOUT,text=True,errors="replace")
        def reader():
            try:
                for line in proc.stdout:
                    if line.startswith(PREFIX):
                        signals.put(line)
            finally:
                proc.stdout.close()
                signals.put(None)
        thread=threading.Thread(target=reader,daemon=True)
        thread.start()
        started=time.monotonic()
        completed=0
        ended=False
        protocol_error=None
        win.show_all()
        try:
            while not ended or proc.poll() is None:
                while Gtk.events_pending():
                    Gtk.main_iteration_do(False)
                try:
                    line=signals.get(timeout=0.1)
                    if line is None:
                        ended=True
                    elif protocol_error is None:
                        try:
                            completed=parse_stage(line,completed)
                            bar.set_fraction(completed/len(STAGES))
                            bar.set_text(f"{completed} of {len(STAGES)} stages completed")
                            status.set_text(STAGES[completed] if completed<len(STAGES) else "Finalizing setup")
                        except RuntimeError as error:
                            protocol_error=error
                except queue.Empty:
                    pass
                activity.pulse()
                seconds=int(time.monotonic()-started)
                elapsed.set_text(f"Working... {seconds//60:02d}:{seconds%60:02d} elapsed. Do not close Setup.")
            if proc.wait()!=0:
                raise RuntimeError("Installation did not complete. Existing files and database volumes were retained. Contact RS Nextward support.")
            if protocol_error:
                raise protocol_error
            if completed!=len(STAGES):
                raise RuntimeError("Setup completion could not be verified. Contact RS Nextward support.")
        finally:
            # Do not interrupt a running database or package operation.
            proc.wait()
            thread.join()
            win.destroy()
            while Gtk.events_pending():
                Gtk.main_iteration_do(False)
