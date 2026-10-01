using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Security;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Toolkit.Uwp.Notifications;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Windows.Data.Xml.Dom;
using Windows.UI.Notifications;

public class Schedule
{
    public string Id {get;set;}
    public string Date {get;set;}
    public bool Done {get;set;}
    public string IdeaDate {get;set;}
    public string IdeaId {get;set;}
    public string Title {get;set;}
    public string Time {get;set;}
    public string At {get;set;}
    public int RemindMinutes {get;set;}
    public bool Important {get;set;}
    public string Status {get;set;}
    public string Error {get;set;}
}
public class Store
{
    public object WidgetState {get;set;}
    public DockPlacement Dock = new DockPlacement();
    public Dictionary<string,Schedule> Schedules = new Dictionary<string,Schedule>();
}
