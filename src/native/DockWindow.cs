using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Linq;
using System.Windows.Forms;
using Microsoft.Win32;

public class DockPlacement
{
    public string Monitor = "";
    public string Edge = "right";
    public double Fraction = 0.4;
}
internal sealed class DockIdea
{
    public string Id, Text;
    public bool Done;
}
internal sealed class DockWindow : Form
{
    readonly JournalWindow main;
    readonly System.Windows.Forms.Timer hover = new System.Windows.Forms.Timer { Interval=80 };
    readonly Font labelFont = new Font("Microsoft YaHei UI",9f);
    readonly Font titleFont = new Font("Microsoft YaHei UI",10f);
    readonly ContextMenuStrip menu = new ContextMenuStrip();
    readonly Bitmap dockIcon = new Bitmap(Path.Combine(Program.AppDir,"schedule-icon.png"));
    readonly List<KeyValuePair<Rectangle,string>> checks = new List<KeyValuePair<Rectangle,string>>();
    bool expanded, dragging, moved;
    Point dragOrigin, windowOrigin;
    DateTime outsideSince, lastRefresh;
    string displayDate = "", saveError = "";
    Schedule schedule;
    List<DockIdea> ideas = new List<DockIdea>();
    readonly Color ink=Color.FromArgb(51,66,55), muted=Color.FromArgb(128,140,128), green=Color.FromArgb(52,108,71);
    const int Layered=0x00080000, ExStyle=-20;
    [StructLayout(LayoutKind.Sequential,Pack=1)]
    struct Blend { public byte Operation, Flags, Alpha, Format; }
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr window,int index);
    [DllImport("user32.dll",SetLastError=true)] static extern int SetWindowLong(IntPtr window,int index,int value);
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr window);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr window,IntPtr dc);
    [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc,IntPtr obj);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
    [DllImport("user32.dll",SetLastError=true)]
    static extern bool UpdateLayeredWindow(IntPtr window,IntPtr screen,ref Point position,ref Size size,IntPtr source,ref Point origin,int key,ref Blend blend,int flags);
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams { get { var p=base.CreateParams;p.ExStyle|=0x08000000|0x00000080;if(!expanded)p.ExStyle|=Layered;return p; } }
    protected override void WndProc(ref Message m)
    {
        // Receive the click without activating the preview window first.
        if(m.Msg==0x0021){m.Result=new IntPtr(3);return;}
        base.WndProc(ref m);
    }
    internal DockWindow(JournalWindow parent)
    {
        main=parent;Text="Schedule · Today";FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;TopMost=true;
        StartPosition=FormStartPosition.Manual;DoubleBuffered=true;BackColor=Color.FromArgb(250,252,248);Icon=main.Icon;
        menu.Items.Add("打开 Schedule",null,delegate{OpenMain();});
        menu.Items.Add("退出",null,delegate{main.RequestExit();});
        ContextMenuStrip=menu;
        FormClosing+=delegate(object sender,FormClosingEventArgs e){if(!Disposing){e.Cancel=true;main.Close();}};
        Shown+=delegate{RefreshToday();Place();hover.Start();};
        VisibleChanged+=delegate{if(!Visible)hover.Stop();};
        MouseDown+=BeginDrag;MouseMove+=MoveDrag;MouseUp+=EndDrag;
        MouseEnter+=delegate{if(!dragging&&!expanded){expanded=true;outsideSince=DateTime.MinValue;Place();Invalidate();}};
        hover.Tick+=delegate {
            if(dragging||menu.Visible)return;
            if((DateTime.Now-lastRefresh).TotalSeconds>=1)RefreshToday();
            var near=Bounds;near.Inflate(12,12);
            if(near.Contains(Cursor.Position)){outsideSince=DateTime.MinValue;if(!expanded){expanded=true;Place();Invalidate();}}
            else if(expanded){if(outsideSince==DateTime.MinValue)outsideSince=DateTime.Now;else if((DateTime.Now-outsideSince).TotalMilliseconds>350){expanded=false;Place();Invalidate();}}
        };
        SystemEvents.DisplaySettingsChanged+=DisplayChanged;
    }
    internal void Reveal(){expanded=false;RefreshToday();Place();Show();hover.Start();}
    void DisplayChanged(object sender,EventArgs e){if(!IsDisposed&&IsHandleCreated)BeginInvoke(new Action(Place));}
    Screen DockScreen(){return Screen.AllScreens.FirstOrDefault(x=>x.DeviceName==Program.Data.Dock.Monitor)??Screen.PrimaryScreen;}
    void Place()
    {
        var area=DockScreen().WorkingArea;var d=Program.Data.Dock;
        int width=expanded?320:44,height=expanded?ExpandedHeight():52;
        width=Math.Min(width,area.Width);height=Math.Min(height,area.Height);
        double fraction=Math.Max(0,Math.Min(1,d.Fraction));int x,y;
        if(d.Edge=="left"||d.Edge=="right"){x=d.Edge=="left"?area.Left:area.Right-width;y=Math.Min(area.Bottom-height,area.Top+(int)(fraction*(area.Height-52)));}
        else{x=Math.Min(area.Right-width,area.Left+(int)(fraction*(area.Width-44)));y=d.Edge=="top"?area.Top:area.Bottom-height;}
        SetBounds(x,y,width,height);
        ApplySurface();
    }
    internal Bitmap RenderCollapsedIcon()
    {
        var image=new Bitmap(Width,Height,PixelFormat.Format32bppPArgb);
        using(var g=Graphics.FromImage(image)){
            g.Clear(Color.Transparent);
            g.InterpolationMode=InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode=PixelOffsetMode.HighQuality;
            // Keep edge alpha; never composite the icon against a chroma-key color.
            g.DrawImage(dockIcon,new Rectangle(8,12,28,28));
        }
        return image;
    }
    void ApplySurface()
    {
        if(!IsHandleCreated)return;
        int style=GetWindowLong(Handle,ExStyle),next=expanded?style&~Layered:style|Layered;
        if(style!=next&&SetWindowLong(Handle,ExStyle,next)==0)throw new System.ComponentModel.Win32Exception();
        if(expanded){Invalidate();return;}
        using(var image=RenderCollapsedIcon()){
            IntPtr screen=GetDC(IntPtr.Zero),dc=IntPtr.Zero,bitmap=IntPtr.Zero,previous=IntPtr.Zero;
            try{
                dc=CreateCompatibleDC(screen);bitmap=image.GetHbitmap(Color.FromArgb(0));previous=SelectObject(dc,bitmap);
                var position=Location;var size=Size;var origin=Point.Empty;var blend=new Blend{Alpha=255,Format=1};
                if(!UpdateLayeredWindow(Handle,screen,ref position,ref size,dc,ref origin,0,ref blend,2))throw new System.ComponentModel.Win32Exception();
            } finally {
                if(previous!=IntPtr.Zero)SelectObject(dc,previous);
                if(bitmap!=IntPtr.Zero)DeleteObject(bitmap);
                if(dc!=IntPtr.Zero)DeleteDC(dc);
                if(screen!=IntPtr.Zero)ReleaseDC(IntPtr.Zero,screen);
            }
        }
    }
    int ExpandedHeight(){return 114+Math.Min(6,ideas.Count)*31+(ideas.Count==0?28:0)+(ideas.Count>6?22:0);}
    internal void RefreshToday()
    {
        displayDate=DateTime.Now.ToString("yyyy-MM-dd");lastRefresh=DateTime.Now;
        Program.Data.Schedules.TryGetValue(displayDate,out schedule);ideas=ReadIdeas(Program.Data.WidgetState,displayDate);
        if(expanded&&!dragging)Place();Invalidate();
    }
    internal static List<DockIdea> ReadIdeas(object state,string date)
    {
        var result=new List<DockIdea>();var root=state as Dictionary<string,object>;object pc,ed,entry,bodyValue,ideaValue;
        if(root==null||!root.TryGetValue("privateContent",out pc))return result;
        var privateContent=pc as Dictionary<string,object>;if(privateContent==null||!privateContent.TryGetValue("edits",out ed))return result;
        var edits=ed as Dictionary<string,object>;if(edits==null||!edits.TryGetValue(date,out entry))return result;
        var record=entry as Dictionary<string,object>;if(record==null||!record.TryGetValue("body",out bodyValue)||(!record.TryGetValue("ideas",out ideaValue)&&!record.TryGetValue("points",out ideaValue)))return result;
        var text=Convert.ToString(bodyValue);var metadata=ideaValue as IEnumerable;if(metadata==null)return result;
        foreach(var value in metadata){
            var p=value as Dictionary<string,object>;if(p==null)continue;
            int offset=Convert.ToInt32(p["offset"]);if(offset<0||offset>=text.Length)continue;
            int end=text.IndexOf('\n',offset);if(end<0)end=text.Length;
            while(end<text.Length){int next=text.IndexOf('\n',end+1);if(next<0)next=text.Length;var following=text.Substring(end+1,next-end-1);if(following=="•"||following.StartsWith("• "))break;end=next;}
            var line=text.Substring(offset,end-offset).TrimStart('•',' ').Trim();
            var plain=String.Concat(line.Select(c=>c>=0xE000&&c<=0xF8FF?"[图片]":c.ToString())).Trim();if(plain.Length==0)continue;
            object done;result.Add(new DockIdea{Id=Convert.ToString(p["id"]),Text=plain.Replace("\n"," "),Done=p.TryGetValue("done",out done)&&Convert.ToBoolean(done)});
        }
        return result;
    }
    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);var g=e.Graphics;g.SmoothingMode=SmoothingMode.AntiAlias;
        if(!expanded)return; // The collapsed surface is supplied with per-pixel alpha.
        using(var border=new Pen(Color.FromArgb(220,228,218)))g.DrawRectangle(border,0,0,Width-1,Height-1);
        checks.Clear();g.DrawIcon(Icon,new Rectangle(15,16,21,21));
        TextRenderer.DrawText(g,"今天 · "+DateTime.Now.ToString("M 月 d 日"),titleFont,new Rectangle(46,16,220,24),ink,TextFormatFlags.NoPadding|TextFormatFlags.VerticalCenter);
        TextRenderer.DrawText(g,"↗",titleFont,new Rectangle(284,16,22,22),muted,TextFormatFlags.NoPadding);
        int y=54;
        string scheduleText=schedule==null?"今天没有定时日程":schedule.Time+"  "+schedule.Title;
        TextRenderer.DrawText(g,scheduleText,labelFont,new Rectangle(18,y,284,33),schedule!=null&&schedule.Important?Color.FromArgb(165,73,69):ink,TextFormatFlags.EndEllipsis|TextFormatFlags.NoPadding|TextFormatFlags.VerticalCenter);
        y+=43;
        foreach(var idea in ideas.Take(6)){
            var rect=new Rectangle(14,y,27,27);checks.Add(new KeyValuePair<Rectangle,string>(rect,idea.Id));
            TextRenderer.DrawText(g,idea.Done?"✓":"○",titleFont,rect,idea.Done?green:muted,TextFormatFlags.NoPadding|TextFormatFlags.VerticalCenter|TextFormatFlags.HorizontalCenter);
            TextRenderer.DrawText(g,idea.Text,labelFont,new Rectangle(48,y,254,27),idea.Done?muted:ink,TextFormatFlags.EndEllipsis|TextFormatFlags.NoPadding|TextFormatFlags.VerticalCenter);y+=31;
        }
        if(ideas.Count==0)TextRenderer.DrawText(g,"还没有想法",labelFont,new Rectangle(18,y,284,26),muted,TextFormatFlags.NoPadding);
        if(ideas.Count>6)TextRenderer.DrawText(g,"还有 "+(ideas.Count-6)+" 项 · 点击打开",labelFont,new Rectangle(18,y,284,22),muted,TextFormatFlags.NoPadding);
        if(saveError.Length>0)TextRenderer.DrawText(g,saveError,labelFont,new Rectangle(18,Height-20,284,18),Color.Firebrick,TextFormatFlags.NoPadding);
    }
    void BeginDrag(object sender,MouseEventArgs e){if(e.Button!=MouseButtons.Left)return;dragging=true;moved=false;dragOrigin=Cursor.Position;windowOrigin=Location;Capture=true;}
    void MoveDrag(object sender,MouseEventArgs e){if(!dragging)return;var delta=new Size(Cursor.Position.X-dragOrigin.X,Cursor.Position.Y-dragOrigin.Y);var tolerance=SystemInformation.DragSize;if(Math.Abs(delta.Width)>Math.Max(8,tolerance.Width)||Math.Abs(delta.Height)>Math.Max(8,tolerance.Height))moved=true;if(moved)Location=windowOrigin+delta;}
    void EndDrag(object sender,MouseEventArgs e)
    {
        if(!dragging||e.Button!=MouseButtons.Left)return;dragging=false;Capture=false;
        if(!moved){if(expanded){var hit=checks.FirstOrDefault(x=>x.Key.Contains(e.Location));if(hit.Value!=null){main.ToggleDockIdea(displayDate,hit.Value);return;}}OpenMain();return;}
        var screen=Screen.FromPoint(Cursor.Position);var area=screen.WorkingArea;var center=new Point(Left+Width/2,Top+Height/2);
        var distances=new[]{Math.Abs(center.X-area.Left),Math.Abs(center.X-area.Right),Math.Abs(center.Y-area.Top),Math.Abs(center.Y-area.Bottom)};
        int edge=Array.IndexOf(distances,distances.Min());var d=Program.Data.Dock;d.Monitor=screen.DeviceName;d.Edge=new[]{"left","right","top","bottom"}[edge];
        d.Fraction=edge<2?(double)(Top-area.Top)/Math.Max(1,area.Height-Height):(double)(Left-area.Left)/Math.Max(1,area.Width-Width);d.Fraction=Math.Max(0,Math.Min(1,d.Fraction));
        expanded=false;Place();outsideSince=DateTime.MinValue;
        try{Program.Save();saveError="";}catch{saveError="位置保存失败";}
        Invalidate();
    }
    void OpenMain(){Program.ActivationDate=DateTime.Now.ToString("yyyy-MM-dd");main.OpenActivation();}
    protected override void Dispose(bool disposing){if(disposing){SystemEvents.DisplaySettingsChanged-=DisplayChanged;hover.Dispose();menu.Dispose();labelFont.Dispose();titleFont.Dispose();dockIcon.Dispose();}base.Dispose(disposing);}
}
